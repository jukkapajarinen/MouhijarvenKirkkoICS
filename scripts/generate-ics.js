import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://sastamalanseurakunta.fi/wp-json/custom/v1/events';
const PER_PAGE = 100;
const MAX_PAGES = 50;
// Taxonomy ids from https://sastamalanseurakunta.fi/tapahtumahaku/ filters:
// srk_tax 73 = Mouhijärvi, pwd_events_category 82 = Jumalanpalvelukset ja uskonelämä.
const PARISH_TAX_ID = 73;
const CATEGORY_ID = 82;
const OUTPUT_PATH = fileURLToPath(new URL('../feed.ics', import.meta.url));
const CALENDAR_NAME = 'Mouhijärven kirkko';
const EVENT_TIMEZONE = 'Europe/Helsinki';
const USER_AGENT =
  'Mozilla/5.0 (compatible; MouhijarvenKirkkoICS/1.0; +https://github.com/jukkapajarinen/MouhijarvenKirkkoICS)';

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function cleanText(html) {
  const text = (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchAllEvents() {
  const events = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${API_URL}?per_page=${PER_PAGE}&page=${page}`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Failed to fetch events (${url}): ${response.status} ${response.statusText}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error(`Unexpected response from ${url}: ${JSON.stringify(batch).slice(0, 200)}`);
    }
    events.push(...batch);
    if (batch.length < PER_PAGE) {
      break;
    }
  }
  return events;
}

function hasTerm(event, taxonomy, id) {
  return (event.taxonomies?.[taxonomy] ?? []).some((term) => Number(term.id) === id);
}

// Offset (ms) of the given time zone from UTC at the given instant.
function timeZoneOffset(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

// Convert a Europe/Helsinki wall-clock date ("2026-11-15") and time ("13:00") to a UTC Date.
function parseLocalDateTime(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  let result = wallAsUtc - timeZoneOffset(new Date(wallAsUtc), EVENT_TIMEZONE);
  // Re-evaluate once in case the guess landed on the other side of a DST change.
  result = wallAsUtc - timeZoneOffset(new Date(result), EVENT_TIMEZONE);
  return new Date(result);
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

function toEvent(event) {
  const cancelled = Boolean(event.meta?.pwd_cancelled);
  const name = decodeEntities(event.name ?? '').trim();
  const title = `${cancelled ? 'PERUTTU: ' : ''}✝️ ${name}`;
  const url = event.url ?? '';
  const linkLine = url ? `URL: ${url}` : null;
  const disclaimer = '⚠️ HUOM! Tämä on koneluettu tapahtuma. Tarkista vielä tiedot virallisesta linkistä! ⚠️';
  const summary = cleanText(event.description) || cleanText(event.excerpt);
  const description = [summary, linkLine, disclaimer].filter(Boolean).join('\n\n');

  const start = parseLocalDateTime(event.start_date, event.start_time);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid date for event ${event.id}: ${event.start_date} ${event.start_time}`);
  }
  let end = start;
  if (event.end_time) {
    const parsedEnd = parseLocalDateTime(event.end_date || event.start_date, event.end_time);
    if (!Number.isNaN(parsedEnd.getTime()) && parsedEnd > start) {
      end = parsedEnd;
    }
  }

  const uid = `${Buffer.from(url || `${event.id}`).toString('base64url')}@mouhijarvenkirkkoics`;

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
  ];
  if (cancelled) {
    lines.push('STATUS:CANCELLED');
  }
  if (url) {
    lines.push(`URL:${url}`);
  }
  lines.push('END:VEVENT');

  return lines;
}

async function main() {
  const allEvents = await fetchAllEvents();
  const events = allEvents
    .filter((event) => hasTerm(event, 'srk_tax', PARISH_TAX_ID) && hasTerm(event, 'pwd_events_category', CATEGORY_ID))
    .sort((a, b) => `${a.start_date} ${a.start_time}`.localeCompare(`${b.start_date} ${b.start_time}`));

  const calendarLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'PRODID:MouhijarvenKirkkoICS',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${CALENDAR_NAME}`,
    `X-WR-TIMEZONE:${EVENT_TIMEZONE}`,
    'X-PUBLISHED-TTL:PT1H',
    ...events.flatMap(toEvent),
    'END:VCALENDAR',
  ];

  const output = calendarLines.map(foldLine).join('\r\n') + '\r\n';

  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote ${events.length} events (of ${allEvents.length} fetched) to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
