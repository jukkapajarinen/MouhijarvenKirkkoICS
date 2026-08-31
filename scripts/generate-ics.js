import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FEED_URL = 'https://www.sastamalanseurakunta.fi/o/events-portlet/feed/parish/?parishId=11670545';
const OUTPUT_PATH = fileURLToPath(new URL('../feed.ics', import.meta.url));
const DEFAULT_DURATION_MINUTES = 60;
const CALENDAR_NAME = 'Mouhijärven kirkko';

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeEntities(stripTags(match[1]).trim()) : '';
}

function extractEntries(xml) {
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return blocks.map((block) => {
    const hrefMatch = block.match(/<link\b[^>]*\bhref="([^"]*)"/);
    return {
      title: extractTag(block, 'title'),
      url: hrefMatch ? decodeEntities(hrefMatch[1]) : '',
      published: extractTag(block, 'published') || extractTag(block, 'updated'),
      summary: extractTag(block, 'summary'),
    };
  });
}

function toUtcStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function escapeIcsText(text) {
  return text.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) {
    return line;
  }

  const folded = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Avoid splitting a multi-byte UTF-8 character in half.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    folded.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }
  return folded.join('\r\n ');
}

function toEvent(entry) {
  const title = entry.title;
  const url = entry.url;
  const description = [entry.summary, url].filter(Boolean).join('\n\n');
  const start = new Date(entry.published);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid date: ${entry.published}`);
  }

  const uid = `${Buffer.from(url || `${title}-${entry.published}`).toString('base64url')}@mouhijarvenkirkkoics`;

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
  ];
  if (url) {
    lines.push(`URL:${url}`);
  }
  lines.push(`DURATION:PT${DEFAULT_DURATION_MINUTES}M`, 'END:VEVENT');

  return lines;
}

async function main() {
  const response = await fetch(FEED_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; MouhijarvenKirkkoICS/1.0; +https://github.com/jukkapajarinen/MouhijarvenKirkkoICS)',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const entries = extractEntries(xml);

  const calendarLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'PRODID:MouhijarvenKirkkoICS',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${CALENDAR_NAME}`,
    'X-PUBLISHED-TTL:PT1H',
    ...entries.flatMap(toEvent),
    'END:VCALENDAR',
  ];

  const output = calendarLines.map(foldLine).join('\r\n') + '\r\n';

  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote ${entries.length} events to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
