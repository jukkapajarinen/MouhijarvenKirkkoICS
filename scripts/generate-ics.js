import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FEED_URL = 'https://www.sastamalanseurakunta.fi/o/events-portlet/feed/parish/?parishId=11670545';
const OUTPUT_PATH = fileURLToPath(new URL('../feed.ics', import.meta.url));
const DEFAULT_DURATION_MINUTES = 60;
const CALENDAR_NAME = 'Mouhijärven kirkko';
const EVENT_TIMEZONE = 'Europe/Helsinki';

// Embedding the DST rules lets calendar apps (Google Calendar in particular) render
// DTSTART;TZID=Europe/Helsinki times in the correct local time instead of falling back
// to UTC+0, which is what happens with bare "Z" UTC timestamps on subscribed feeds.
const VTIMEZONE_LINES = [
  'BEGIN:VTIMEZONE',
  `TZID:${EVENT_TIMEZONE}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'TZNAME:EEST',
  'DTSTART:19700329T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'TZNAME:EET',
  'DTSTART:19701025T040000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

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

function parseFeedDate(raw) {
  // The source feed reports the event's real Europe/Helsinki wall-clock time but wrongly
  // tacks on that same offset as a suffix (e.g. +0300) as if it still needed converting.
  // Honoring that offset shifts every event 2-3 hours earlier than reality, so instead
  // treat the raw digits as the UTC instant directly (as if suffixed with Z).
  const utcLike = raw.replace(/([+-]\d{2}:?\d{2}|Z)$/, 'Z');
  return new Date(utcLike);
}

function toUtcStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function toZonedStamp(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`;
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
  const start = parseFeedDate(entry.published);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid date: ${entry.published}`);
  }

  const uid = `${Buffer.from(url || `${title}-${entry.published}`).toString('base64url')}@mouhijarvenkirkkoics`;

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART;TZID=${EVENT_TIMEZONE}:${toZonedStamp(start, EVENT_TIMEZONE)}`,
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
    `X-WR-TIMEZONE:${EVENT_TIMEZONE}`,
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE_LINES,
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
