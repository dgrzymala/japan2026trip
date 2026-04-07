// ============================================================
// Kraków Concerts Newsletter - Google Apps Script
// Wysyła newsletter co poniedziałek z koncertami na najbliższe 2 tygodnie
// Kluby: Klub Re, Alchemia, Hype Park, Klub Kwadrat
// ============================================================

// ---- KONFIGURACJA ----
const CONFIG = {
  EMAIL_RECIPIENTS: 'TWOJ_EMAIL@gmail.com', // zmień na swój email (lub lista oddzielona przecinkami)
  EMAIL_SUBJECT_PREFIX: '🎵 Koncerty w Krakowie',
  DAYS_AHEAD: 14,
  SENDER_NAME: 'Krakowski Newsletter Koncertowy',
  // Songkick API (opcjonalnie, jako backup)
  SONGKICK_API_KEY: '', // zarejestruj się na songkick.com/developer jeśli chcesz

  // Spotify API (do wzbogacania danych o artystach)
  SPOTIFY_CLIENT_ID: 'TWOJ_SPOTIFY_CLIENT_ID',
  SPOTIFY_CLIENT_SECRET: 'TWOJ_SPOTIFY_CLIENT_SECRET',

  // Preferowane gatunki muzyczne (do filtrowania)
  PREFERRED_GENRES: [
    'rock', 'indie', 'alternative', 'alt', 'punk', 'post-punk', 'garage',
    'grunge', 'shoegaze', 'new wave', 'britpop', 'psychedelic', 'stoner',
    'prog', 'noise', 'art rock', 'lo-fi', 'emo', 'folk rock', 'blues rock',
    'dream pop', 'post-rock', 'math rock', 'krautrock', 'singer-songwriter',
  ],

  // Czy filtrować koncerty po gatunku (false = pokaż wszystkie)
  FILTER_BY_GENRE: true,
};

// ---- GŁÓWNA FUNKCJA ----
function sendConcertNewsletter() {
  const today = new Date();
  const endDate = new Date(today.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);

  Logger.log('Pobieranie koncertów od ' + formatDatePL(today) + ' do ' + formatDatePL(endDate));

  const allEvents = [];

  // Pobierz koncerty z każdego klubu
  const sources = [
    { name: 'Klub Alchemia', fn: fetchAlchemiaEvents },
    { name: 'Klub Re', fn: fetchKlubReEvents },
    { name: 'Klub Kwadrat', fn: fetchKlubKwadratEvents },
    { name: 'Hype Park', fn: fetchHypeParkEvents },
  ];

  for (const source of sources) {
    try {
      Logger.log('Pobieranie: ' + source.name);
      const events = source.fn(today, endDate);
      Logger.log('Znaleziono ' + events.length + ' wydarzeń w ' + source.name);
      allEvents.push(...events);
    } catch (e) {
      Logger.log('BŁĄD przy pobieraniu ' + source.name + ': ' + e.message);
    }
  }

  // Sortuj po dacie
  allEvents.sort((a, b) => (a.date || new Date(0)) - (b.date || new Date(0)));

  if (allEvents.length === 0) {
    Logger.log('Brak koncertów do wysłania.');
    return;
  }

  // Generuj i wyślij email
  const html = buildNewsletterHtml(allEvents, today, endDate);
  sendEmail(html, today);
  Logger.log('Newsletter wysłany! Liczba koncertów: ' + allEvents.length);
}

// ============================================================
// ŹRÓDŁA DANYCH
// ============================================================

// ---- ALCHEMIA (RSS Feed) ----
function fetchAlchemiaEvents(startDate, endDate) {
  const events = [];

  try {
    const rssUrl = 'https://alchemia.com.pl/feed/';
    const response = UrlFetchApp.fetch(rssUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return events;

    const xml = XmlService.parse(response.getContentText());
    const root = xml.getRootElement();
    const channel = root.getChild('channel');
    const items = channel.getChildren('item');

    for (const item of items) {
      const title = item.getChildText('title') || '';
      const link = item.getChildText('link') || '';
      const description = getChildTextByNS(item, 'encoded', 'http://purl.org/rss/1.0/modules/content/')
        || item.getChildText('description') || '';

      // Wyciągnij datę z opisu lub z treści strony
      const eventDate = extractDateFromContent(description) || extractDateFromContent(title);
      const cleanDesc = cleanHtml(description);

      // Sprawdź czy opis zawiera datę w zakresie
      const event = {
        club: 'Alchemia',
        title: title,
        description: truncateText(cleanDesc, 200),
        date: eventDate,
        dateText: eventDate ? formatDatePL(eventDate) : 'Sprawdź na stronie',
        price: extractPrice(description) || extractPrice(cleanDesc),
        link: link,
      };

      if (eventDate && eventDate >= startDate && eventDate <= endDate) {
        events.push(event);
      } else if (!eventDate) {
        // Dodaj bez filtrowania po dacie - użytkownik sprawdzi
        events.push(event);
      }
    }
  } catch (e) {
    Logger.log('Alchemia RSS error: ' + e.message);
  }

  // Fallback: scrape HTML
  if (events.length === 0) {
    try {
      const events2 = scrapeAlchemiaHtml(startDate, endDate);
      events.push(...events2);
    } catch (e) {
      Logger.log('Alchemia HTML scrape error: ' + e.message);
    }
  }

  return events;
}

function scrapeAlchemiaHtml(startDate, endDate) {
  const events = [];
  const url = 'https://alchemia.com.pl/program/';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return events;

  const html = response.getContentText();

  // Szukaj artykułów z wydarzeniami
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const articleHtml = match[1];
    const titleMatch = articleHtml.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
    const linkMatch = articleHtml.match(/href="(https?:\/\/alchemia\.com\.pl\/[^"]*wydarzenie[^"]*)"/i)
      || articleHtml.match(/href="(https?:\/\/alchemia\.com\.pl\/[^"]*)"[^>]*>/i);
    const dateMatch = articleHtml.match(/(\d{1,2})\s+(sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru)\w*\s*(\d{2}:\d{2})?/i)
      || articleHtml.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);

    if (titleMatch) {
      const title = cleanHtml(titleMatch[1]);
      const link = linkMatch ? linkMatch[1] : url;
      const eventDate = dateMatch ? parsePolishDate(dateMatch[0]) : null;
      const desc = cleanHtml(articleHtml).substring(0, 200);

      if (!eventDate || (eventDate >= startDate && eventDate <= endDate)) {
        events.push({
          club: 'Alchemia',
          title: title,
          description: truncateText(desc, 200),
          date: eventDate,
          dateText: eventDate ? formatDatePL(eventDate) : 'Sprawdź na stronie',
          price: extractPrice(articleHtml),
          link: link,
        });
      }
    }
  }

  return events;
}

// ---- KLUB RE (HTML Scraping) ----
function fetchKlubReEvents(startDate, endDate) {
  const events = [];
  const url = 'https://klubre.pl/program/';

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return events;

    const html = response.getContentText();

    // Klub Re wyświetla eventy jako karty z datą, tytułem i linkiem
    // Szukamy wzorców z datami i tytułami
    const eventBlocks = html.split(/<(?:article|div)[^>]*class="[^"]*(?:event|post|program|koncert)[^"]*"[^>]*>/i);

    if (eventBlocks.length <= 1) {
      // Alternatywny parsing - szukaj sekcji z datami
      return parseKlubReAlternative(html, startDate, endDate);
    }

    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i].split(/<\/(?:article|div)>/i)[0] || eventBlocks[i];
      const parsed = parseEventBlock(block, 'Klub Re', 'https://klubre.pl');

      if (parsed) {
        if (!parsed.date || (parsed.date >= startDate && parsed.date <= endDate)) {
          events.push(parsed);
        }
      }
    }
  } catch (e) {
    Logger.log('Klub Re error: ' + e.message);
  }

  // Fallback: RSS
  if (events.length === 0) {
    try {
      const rssEvents = fetchKlubReRss(startDate, endDate);
      events.push(...rssEvents);
    } catch (e) {
      Logger.log('Klub Re RSS fallback error: ' + e.message);
    }
  }

  return events;
}

function parseKlubReAlternative(html, startDate, endDate) {
  const events = [];

  // Szukaj linków do koncertów
  const linkRegex = /href="(https?:\/\/klubre\.pl\/koncert\/[^"]+)"/gi;
  const links = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    if (!links.includes(m[1])) links.push(m[1]);
  }

  // Szukaj dat i tytułów w okolicy linków
  const dateTimeRegex = /(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4}|\d{1,2}\s+(?:sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru)\w*(?:\s+\d{4})?)/gi;
  const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

  const headings = [];
  while ((m = headingRegex.exec(html)) !== null) {
    headings.push({ text: cleanHtml(m[1]), index: m.index });
  }

  const dates = [];
  while ((m = dateTimeRegex.exec(html)) !== null) {
    dates.push({ text: m[1], index: m.index, date: parsePolishDate(m[1]) });
  }

  // Mapuj daty na nagłówki (najbliższy nagłówek po dacie)
  for (const d of dates) {
    if (!d.date || d.date < startDate || d.date > endDate) continue;

    const nearestHeading = headings.reduce((closest, h) => {
      const dist = Math.abs(h.index - d.index);
      if (!closest || dist < closest.dist) return { ...h, dist };
      return closest;
    }, null);

    if (nearestHeading && nearestHeading.text) {
      const nearestLink = links.find(l => {
        const slug = l.split('/').pop().replace(/-/g, ' ').toLowerCase();
        return nearestHeading.text.toLowerCase().includes(slug.substring(0, 10));
      }) || links[0];

      events.push({
        club: 'Klub Re',
        title: nearestHeading.text,
        description: '',
        date: d.date,
        dateText: formatDatePL(d.date),
        price: '',
        link: nearestLink || 'https://klubre.pl/program/',
      });
    }
  }

  // Jeśli nadal brak, pobierz poszczególne strony koncertów
  if (events.length === 0 && links.length > 0) {
    for (const link of links.slice(0, 15)) {
      try {
        const resp = UrlFetchApp.fetch(link, { muteHttpExceptions: true });
        if (resp.getResponseCode() !== 200) continue;
        const pageHtml = resp.getContentText();

        const titleM = pageHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const dateM = pageHtml.match(/(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{2,4})/);
        const dateM2 = pageHtml.match(/(\d{1,2})\s+(sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru)\w*\s*(\d{4})?/i);
        const priceM = pageHtml.match(/(\d+)\s*(?:zł|PLN|pln)/i);

        const eventDate = dateM ? parsePolishDate(dateM[1]) : (dateM2 ? parsePolishDate(dateM2[0]) : null);

        if (eventDate && eventDate >= startDate && eventDate <= endDate) {
          const descM = pageHtml.match(/<div[^>]*class="[^"]*(?:entry-content|post-content|content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          events.push({
            club: 'Klub Re',
            title: titleM ? cleanHtml(titleM[1]) : link.split('/').slice(-2, -1)[0].replace(/-/g, ' '),
            description: descM ? truncateText(cleanHtml(descM[1]), 200) : '',
            date: eventDate,
            dateText: formatDatePL(eventDate),
            price: priceM ? priceM[1] + ' zł' : '',
            link: link,
          });
        }
      } catch (e) {
        Logger.log('Klub Re page error: ' + e.message);
      }
    }
  }

  return events;
}

function fetchKlubReRss(startDate, endDate) {
  const events = [];
  const rssUrl = 'https://klubre.pl/feed/';

  const response = UrlFetchApp.fetch(rssUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return events;

  const xml = XmlService.parse(response.getContentText());
  const root = xml.getRootElement();
  const channel = root.getChild('channel');
  const items = channel.getChildren('item');

  for (const item of items) {
    const title = item.getChildText('title') || '';
    const link = item.getChildText('link') || '';
    const description = item.getChildText('description') || '';
    const content = getChildTextByNS(item, 'encoded', 'http://purl.org/rss/1.0/modules/content/') || '';

    const fullText = title + ' ' + description + ' ' + content;
    const eventDate = extractDateFromContent(fullText);
    const cleanDesc = cleanHtml(content || description);

    if (!eventDate || (eventDate >= startDate && eventDate <= endDate)) {
      events.push({
        club: 'Klub Re',
        title: title,
        description: truncateText(cleanDesc, 200),
        date: eventDate,
        dateText: eventDate ? formatDatePL(eventDate) : 'Sprawdź na stronie',
        price: extractPrice(fullText),
        link: link || 'https://klubre.pl/program/',
      });
    }
  }

  return events;
}

// ---- KLUB KWADRAT (RSS + HTML) ----
function fetchKlubKwadratEvents(startDate, endDate) {
  const events = [];

  // Najpierw RSS
  try {
    const rssUrl = 'https://klubkwadrat.pl/feed/';
    const response = UrlFetchApp.fetch(rssUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      const xml = XmlService.parse(response.getContentText());
      const root = xml.getRootElement();
      const channel = root.getChild('channel');
      const items = channel.getChildren('item');

      for (const item of items) {
        const title = item.getChildText('title') || '';
        const link = item.getChildText('link') || '';
        const content = getChildTextByNS(item, 'encoded', 'http://purl.org/rss/1.0/modules/content/')
          || item.getChildText('description') || '';

        const eventDate = extractDateFromContent(title + ' ' + content);
        const cleanDesc = cleanHtml(content);

        if (!eventDate || (eventDate >= startDate && eventDate <= endDate)) {
          events.push({
            club: 'Klub Kwadrat',
            title: title,
            description: truncateText(cleanDesc, 200),
            date: eventDate,
            dateText: eventDate ? formatDatePL(eventDate) : 'Sprawdź na stronie',
            price: extractPrice(content),
            link: link || 'https://klubkwadrat.pl/wydarzenia/',
          });
        }
      }
    }
  } catch (e) {
    Logger.log('Klub Kwadrat RSS error: ' + e.message);
  }

  // Scrape strony HTML jako uzupełnienie/fallback
  try {
    const htmlEvents = scrapeKlubKwadratHtml(startDate, endDate);
    // Dodaj tylko te, których nie mamy jeszcze z RSS (po tytule)
    const existingTitles = new Set(events.map(e => e.title.toLowerCase()));
    for (const e of htmlEvents) {
      if (!existingTitles.has(e.title.toLowerCase())) {
        events.push(e);
      }
    }
  } catch (e) {
    Logger.log('Klub Kwadrat HTML error: ' + e.message);
  }

  return events;
}

function scrapeKlubKwadratHtml(startDate, endDate) {
  const events = [];
  const url = 'https://klubkwadrat.pl/wydarzenia/';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return events;

  const html = response.getContentText();

  // Szukaj postów Divi lub standardowych WP
  const postRegex = /<article[^>]*class="[^"]*(?:et_pb_post|post)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = postRegex.exec(html)) !== null) {
    const block = match[1];
    const parsed = parseEventBlock(block, 'Klub Kwadrat', 'https://klubkwadrat.pl');
    if (parsed && (!parsed.date || (parsed.date >= startDate && parsed.date <= endDate))) {
      events.push(parsed);
    }
  }

  // Alternatywnie szukaj h2/h3 z linkami
  if (events.length === 0) {
    const headingLinkRegex = /<h[2-4][^>]*>\s*<a\s+href="(https?:\/\/klubkwadrat\.pl\/[^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[2-4]>/gi;
    while ((match = headingLinkRegex.exec(html)) !== null) {
      const link = match[1];
      const title = cleanHtml(match[2]);

      events.push({
        club: 'Klub Kwadrat',
        title: title,
        description: '',
        date: null,
        dateText: 'Sprawdź na stronie',
        price: '',
        link: link,
      });
    }
  }

  return events;
}

// ---- HYPE PARK (eBilet.pl JSON-LD) ----
function fetchHypeParkEvents(startDate, endDate) {
  const events = [];

  // Źródło 1: eBilet.pl
  try {
    const ebiletEvents = scrapeEbiletHypePark(startDate, endDate);
    events.push(...ebiletEvents);
  } catch (e) {
    Logger.log('Hype Park eBilet error: ' + e.message);
  }

  // Źródło 2: Songkick (backup)
  if (events.length === 0) {
    try {
      const songkickEvents = scrapeSongkickVenue('hype-park', '10222035', startDate, endDate);
      events.push(...songkickEvents);
    } catch (e) {
      Logger.log('Hype Park Songkick error: ' + e.message);
    }
  }

  return events;
}

function scrapeEbiletHypePark(startDate, endDate) {
  const events = [];
  const url = 'https://www.ebilet.pl/miejsce/hype-park/';

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GoogleAppsScript)',
      'Accept': 'text/html',
    },
  });

  if (response.getResponseCode() !== 200) return events;
  const html = response.getContentText();

  // Szukaj JSON-LD
  const jsonLdRegex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);

      // Może być ItemList lub pojedynczy Event
      if (data['@type'] === 'ItemList' && data.itemListElement) {
        for (const item of data.itemListElement) {
          const eventData = item.item || item;
          const event = parseJsonLdEvent(eventData, 'Hype Park', startDate, endDate);
          if (event) events.push(event);
        }
      } else if (data['@type'] === 'Event' || data['@type'] === 'MusicEvent') {
        const event = parseJsonLdEvent(data, 'Hype Park', startDate, endDate);
        if (event) events.push(event);
      } else if (Array.isArray(data)) {
        for (const d of data) {
          if (d['@type'] === 'Event' || d['@type'] === 'MusicEvent') {
            const event = parseJsonLdEvent(d, 'Hype Park', startDate, endDate);
            if (event) events.push(event);
          }
        }
      }
    } catch (e) {
      Logger.log('JSON-LD parse error: ' + e.message);
    }
  }

  // Fallback: szukaj eventów w HTML
  if (events.length === 0) {
    const eventCardRegex = /<a[^>]*href="(\/[^"]*)"[^>]*class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = eventCardRegex.exec(html)) !== null) {
      const link = 'https://www.ebilet.pl' + match[1];
      const content = match[2];
      const titleM = content.match(/<[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\//i);
      const dateM = content.match(/(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{2,4})/);

      if (titleM) {
        const eventDate = dateM ? parsePolishDate(dateM[1]) : null;
        if (!eventDate || (eventDate >= startDate && eventDate <= endDate)) {
          events.push({
            club: 'Hype Park',
            title: cleanHtml(titleM[1]),
            description: '',
            date: eventDate,
            dateText: eventDate ? formatDatePL(eventDate) : 'Sprawdź na stronie',
            price: extractPrice(content),
            link: link,
          });
        }
      }
    }
  }

  return events;
}

// ---- SONGKICK (backup/universal) ----
function scrapeSongkickVenue(venueSlug, venueId, startDate, endDate) {
  const events = [];
  const url = 'https://www.songkick.com/venues/' + venueId + '-' + venueSlug;

  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GoogleAppsScript)',
        'Accept': 'text/html',
      },
    });

    if (response.getResponseCode() !== 200) return events;
    const html = response.getContentText();

    // Szukaj JSON-LD MusicEvent
    const jsonLdRegex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          if (item['@type'] === 'MusicEvent' || item['@type'] === 'Event') {
            const event = parseJsonLdEvent(item, 'Hype Park', startDate, endDate);
            if (event) events.push(event);
          }
        }
      } catch (e) {}
    }
  } catch (e) {
    Logger.log('Songkick scrape error: ' + e.message);
  }

  return events;
}

// ============================================================
// PARSOWANIE I NARZĘDZIA
// ============================================================

function parseJsonLdEvent(data, clubName, startDate, endDate) {
  if (!data) return null;

  const name = data.name || '';
  const eventUrl = data.url || '';
  const startDateStr = data.startDate || '';
  const description = data.description || '';

  let eventDate = null;
  if (startDateStr) {
    eventDate = new Date(startDateStr);
    if (isNaN(eventDate.getTime())) eventDate = null;
  }

  if (eventDate && (eventDate < startDate || eventDate > endDate)) return null;

  // Cena
  let price = '';
  if (data.offers) {
    const offers = Array.isArray(data.offers) ? data.offers : [data.offers];
    for (const offer of offers) {
      if (offer.price) {
        price = offer.price + ' ' + (offer.priceCurrency || 'PLN');
        break;
      } else if (offer.lowPrice) {
        price = 'od ' + offer.lowPrice + ' ' + (offer.priceCurrency || 'PLN');
        break;
      }
    }
  }

  // Wykonawcy
  let performers = '';
  if (data.performer) {
    const perfArr = Array.isArray(data.performer) ? data.performer : [data.performer];
    performers = perfArr.map(p => p.name || '').filter(Boolean).join(', ');
  }

  return {
    club: clubName,
    title: name,
    description: truncateText(description || (performers ? 'Wykonawcy: ' + performers : ''), 200),
    date: eventDate,
    dateText: eventDate ? formatDatePL(eventDate) : 'Sprawdź na stronie',
    price: price,
    link: eventUrl,
  };
}

function parseEventBlock(block, clubName, baseUrl) {
  const titleMatch = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const linkMatch = block.match(/href="([^"]+)"/i);
  const dateMatch = block.match(/(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/i)
    || block.match(/(\d{1,2})\s+(sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru)\w*(?:\s+\d{4})?\s*(?:\d{2}:\d{2})?/i);
  const priceMatch = extractPrice(block);

  if (!titleMatch) return null;

  const title = cleanHtml(titleMatch[1]);
  let link = linkMatch ? linkMatch[1] : '';
  if (link && !link.startsWith('http')) {
    link = baseUrl + (link.startsWith('/') ? '' : '/') + link;
  }

  const eventDate = dateMatch ? parsePolishDate(dateMatch[0]) : null;
  const description = cleanHtml(block).substring(0, 200);

  return {
    club: clubName,
    title: title,
    description: truncateText(description, 200),
    date: eventDate,
    dateText: eventDate ? formatDatePL(eventDate) : 'Sprawdź na stronie',
    price: priceMatch || '',
    link: link || baseUrl,
  };
}

// ---- PARSOWANIE DAT ----
const POLISH_MONTHS = {
  'sty': 0, 'stycz': 0, 'stycznia': 0,
  'lut': 1, 'luty': 1, 'lutego': 1,
  'mar': 2, 'marz': 2, 'marca': 2,
  'kwi': 3, 'kwiet': 3, 'kwietnia': 3,
  'maj': 4, 'maja': 4,
  'cze': 5, 'czerw': 5, 'czerwca': 5,
  'lip': 6, 'lipc': 6, 'lipca': 6,
  'sie': 7, 'sierp': 7, 'sierpnia': 7,
  'wrz': 8, 'wrześ': 8, 'września': 8,
  'paź': 9, 'październ': 9, 'października': 9,
  'lis': 10, 'listop': 10, 'listopada': 10,
  'gru': 11, 'grudz': 11, 'grudnia': 11,
};

function parsePolishDate(text) {
  if (!text) return null;

  // Format: DD.MM.YYYY lub DD-MM-YYYY
  let m = text.match(/(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{2,4})/);
  if (m) {
    let year = parseInt(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, parseInt(m[2]) - 1, parseInt(m[1]));
  }

  // Format: DD miesiąc YYYY
  m = text.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)(?:\s+(\d{4}))?/i);
  if (m) {
    const day = parseInt(m[1]);
    const monthStr = m[2].toLowerCase();
    let month = -1;

    for (const [key, val] of Object.entries(POLISH_MONTHS)) {
      if (monthStr.startsWith(key) || key.startsWith(monthStr.substring(0, 3))) {
        month = val;
        break;
      }
    }

    if (month >= 0) {
      const year = m[3] ? parseInt(m[3]) : new Date().getFullYear();
      return new Date(year, month, day);
    }
  }

  return null;
}

function extractDateFromContent(content) {
  if (!content) return null;

  // Szukaj różnych formatów dat
  const patterns = [
    /(\d{1,2})[\.\-](\d{1,2})[\.\-](\d{4})/,
    /(\d{1,2})\s+(sty\w*|lut\w*|mar\w*|kwi\w*|maj\w*|cze\w*|lip\w*|sie\w*|wrz\w*|paź\w*|lis\w*|gru\w*)\s*(\d{4})?/i,
    /(\d{4})-(\d{2})-(\d{2})/,
  ];

  for (const pattern of patterns) {
    const m = content.match(pattern);
    if (m) {
      // ISO format
      if (m[0].match(/^\d{4}-\d{2}-\d{2}/)) {
        return new Date(m[0]);
      }
      return parsePolishDate(m[0]);
    }
  }

  return null;
}

function extractPrice(text) {
  if (!text) return '';
  const m = text.match(/(\d+(?:[,.]\d+)?)\s*(?:zł|PLN|pln)/i);
  if (m) return m[1].replace(',', '.') + ' zł';

  const m2 = text.match(/(?:cena|bilet|wstęp|wejście)[:\s]*(\d+)/i);
  if (m2) return m2[1] + ' zł';

  const m3 = text.match(/(?:free|bezpłatnie|wstęp\s*wolny|za\s*darmo)/i);
  if (m3) return 'Wstęp wolny';

  return '';
}

// ---- FORMATOWANIE ----
function formatDatePL(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const days = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const months = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
    'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  return days[date.getDay()] + ', ' + date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
}

function formatDateShortPL(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const days = ['ndz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
  return days[date.getDay()] + ' ' + date.getDate() + '.' + String(date.getMonth() + 1).padStart(2, '0');
}

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen).replace(/\s\S*$/, '') + '...';
}

function getChildTextByNS(element, localName, nsUri) {
  try {
    const ns = XmlService.getNamespace(nsUri);
    const child = element.getChild(localName, ns);
    return child ? child.getText() : null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// SPOTIFY API
// ============================================================

function getSpotifyToken_() {
  const url = 'https://accounts.spotify.com/api/token';
  const credentials = Utilities.base64Encode(CONFIG.SPOTIFY_CLIENT_ID + ':' + CONFIG.SPOTIFY_CLIENT_SECRET);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Authorization': 'Basic ' + credentials,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    payload: 'grant_type=client_credentials',
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Spotify token error: ' + response.getContentText());
    return null;
  }

  return JSON.parse(response.getContentText()).access_token;
}

function searchSpotifyArtist_(artistName, token) {
  if (!token || !artistName) return null;

  const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(artistName) + '&type=artist&limit=1';

  try {
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) return null;

    const data = JSON.parse(response.getContentText());
    if (!data.artists || !data.artists.items || data.artists.items.length === 0) return null;

    const artist = data.artists.items[0];
    return {
      spotifyUrl: (artist.external_urls && artist.external_urls.spotify) || '',
      imageUrl: (artist.images && artist.images.length > 0) ? artist.images[0].url : '',
      genres: artist.genres || [],
      popularity: artist.popularity || 0,
    };
  } catch (e) {
    Logger.log('Spotify search error for "' + artistName + '": ' + e.message);
    return null;
  }
}

function extractArtistName_(eventTitle) {
  // Próbuj wyciągnąć nazwę artysty z tytułu eventu
  // Wzorce: "ARTYSTA - Trasa", "ARTYSTA + support", "ARTYSTA w Krakowie", "ARTYSTA live"
  let name = eventTitle;

  // Usuń typowe sufiksy
  name = name.replace(/\s*[-–—]\s*(trasa|tour|koncert|live|nowa|acoustic|unplugged|premiera).*/i, '');
  name = name.replace(/\s*\+\s*support.*/i, '');
  name = name.replace(/\s+w\s+(krakowie|klubie|alchemii).*/i, '');
  name = name.replace(/\s*\|\s*.*/i, '');
  name = name.replace(/\s*\/\s*.*/i, '');
  name = name.replace(/\s*@\s*.*/i, '');

  return name.trim();
}

function matchesPreferredGenres_(genres) {
  if (!CONFIG.FILTER_BY_GENRE) return true;
  if (!genres || genres.length === 0) return true; // nieznany gatunek - pokaż

  const lowerGenres = genres.map(g => g.toLowerCase());
  return CONFIG.PREFERRED_GENRES.some(pref =>
    lowerGenres.some(g => g.includes(pref))
  );
}

function enrichEventsWithSpotify_(events) {
  const token = getSpotifyToken_();
  if (!token) {
    Logger.log('Brak tokena Spotify - pomijam wzbogacanie danych');
    return events;
  }

  const enriched = [];
  for (const event of events) {
    const artistName = extractArtistName_(event.title);
    const spotifyData = searchSpotifyArtist_(artistName, token);

    if (spotifyData) {
      event.artistName = artistName;
      event.spotifyUrl = spotifyData.spotifyUrl;
      event.imageUrl = spotifyData.imageUrl;
      event.genres = spotifyData.genres;
      event.genreDisplay = spotifyData.genres.slice(0, 3).join(' / ') || '';
      event.appleMusicUrl = 'https://music.apple.com/search?term=' + encodeURIComponent(artistName);

      if (matchesPreferredGenres_(spotifyData.genres)) {
        enriched.push(event);
      } else {
        Logger.log('Odfiltrowano (gatunek): ' + artistName + ' [' + spotifyData.genres.join(', ') + ']');
      }
    } else {
      // Nie znaleziono na Spotify - pokaż i tak
      event.artistName = artistName;
      event.spotifyUrl = 'https://open.spotify.com/search/' + encodeURIComponent(artistName);
      event.imageUrl = '';
      event.genres = [];
      event.genreDisplay = '';
      event.appleMusicUrl = 'https://music.apple.com/search?term=' + encodeURIComponent(artistName);
      enriched.push(event);
    }

    // Pauza aby nie przekroczyć limitu Spotify API
    Utilities.sleep(100);
  }

  return enriched;
}

// ============================================================
// JSON API (Web App endpoint)
// ============================================================

function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;

  // Sprawdź cache w PropertiesService
  const props = PropertiesService.getScriptProperties();
  let cachedJson = props.getProperty('concerts_json_cache');
  let cacheTime = props.getProperty('concerts_json_cache_time');

  // Regeneruj jeśli cache starszy niż 6h lub pusty
  const sixHours = 6 * 60 * 60 * 1000;
  if (!cachedJson || !cacheTime || (Date.now() - parseInt(cacheTime)) > sixHours) {
    cachedJson = generateConcertsJson_();
    props.setProperty('concerts_json_cache', cachedJson);
    props.setProperty('concerts_json_cache_time', String(Date.now()));
  }

  if (callback) {
    return ContentService.createTextOutput(callback + '(' + cachedJson + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(cachedJson)
    .setMimeType(ContentService.MimeType.JSON);
}

function generateConcertsJson_() {
  const today = new Date();
  const endDate = new Date(today.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);

  const allEvents = [];
  const sources = [
    { name: 'Alchemia', fn: fetchAlchemiaEvents },
    { name: 'Klub Re', fn: fetchKlubReEvents },
    { name: 'Klub Kwadrat', fn: fetchKlubKwadratEvents },
    { name: 'Hype Park', fn: fetchHypeParkEvents },
  ];

  for (const source of sources) {
    try {
      const events = source.fn(today, endDate);
      allEvents.push(...events);
    } catch (e) {
      Logger.log('JSON gen error (' + source.name + '): ' + e.message);
    }
  }

  // Sortuj po dacie
  allEvents.sort((a, b) => (a.date || new Date(0)) - (b.date || new Date(0)));

  // Wzbogać danymi ze Spotify i filtruj po gatunku
  const enriched = enrichEventsWithSpotify_(allEvents);

  // Formatuj jako JSON dla frontendu
  const jsonEvents = enriched.map((e, i) => {
    const isoDate = e.date ? formatISODateGAS_(e.date) : '';
    const time = e.date ? String(e.date.getHours()).padStart(2, '0') + ':' + String(e.date.getMinutes()).padStart(2, '0') : '';

    return {
      id: 'ev-' + isoDate + '-' + i + '-' + (e.artistName || '').replace(/\s+/g, '-').toLowerCase().substring(0, 20),
      artist: e.artistName || e.title,
      title: e.title,
      date: isoDate,
      time: time !== '00:00' ? time : '',
      venue: e.club,
      genre: e.genreDisplay || '',
      description: e.description || '',
      imageUrl: e.imageUrl || '',
      ticketPrice: e.price || '',
      ticketUrl: e.link || '',
      spotifyUrl: e.spotifyUrl || '',
      appleMusicUrl: e.appleMusicUrl || '',
    };
  });

  return JSON.stringify({
    generated: new Date().toISOString(),
    dateRange: {
      from: formatISODateGAS_(today),
      to: formatISODateGAS_(endDate),
    },
    events: jsonEvents,
  });
}

function formatISODateGAS_(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * Ręcznie odśwież cache JSON (uruchom po zmianie konfiguracji).
 */
function refreshJsonCache() {
  const json = generateConcertsJson_();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('concerts_json_cache', json);
  props.setProperty('concerts_json_cache_time', String(Date.now()));
  Logger.log('Cache odświeżony. Liczba eventów: ' + JSON.parse(json).events.length);
}

// ============================================================
// GENEROWANIE EMAILA
// ============================================================

function buildNewsletterHtml(events, startDate, endDate) {
  // Grupuj po klubie
  const byClub = {};
  for (const e of events) {
    if (!byClub[e.club]) byClub[e.club] = [];
    byClub[e.club].push(e);
  }

  const clubColors = {
    'Alchemia': '#8B0000',
    'Klub Re': '#2E4057',
    'Hype Park': '#FF6B35',
    'Klub Kwadrat': '#4A90D9',
  };

  const clubUrls = {
    'Alchemia': 'https://alchemia.com.pl/program/',
    'Klub Re': 'https://klubre.pl/program/',
    'Hype Park': 'https://www.ebilet.pl/miejsce/hype-park/',
    'Klub Kwadrat': 'https://klubkwadrat.pl/wydarzenia/',
  };

  let clubsHtml = '';

  for (const [club, clubEvents] of Object.entries(byClub)) {
    const color = clubColors[club] || '#333';
    const clubUrl = clubUrls[club] || '#';

    let eventsHtml = '';
    for (const e of clubEvents) {
      const priceHtml = e.price
        ? '<span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:12px;font-size:13px;font-weight:600;">' + e.price + '</span>'
        : '<span style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:12px;font-size:12px;">Cena na stronie</span>';

      const linkHtml = e.link
        ? '<a href="' + e.link + '" style="color:' + color + ';font-weight:600;text-decoration:none;font-size:13px;">Szczegóły / Bilety →</a>'
        : '';

      const dateLabel = e.date ? formatDateShortPL(e.date) : '';

      eventsHtml += `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  ${dateLabel ? '<div style="color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">📅 ' + dateLabel + '</div>' : ''}
                  <div style="font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${escapeHtml(e.title)}</div>
                  ${e.description ? '<div style="font-size:13px;color:#555;margin-bottom:6px;line-height:1.4;">' + escapeHtml(e.description) + '</div>' : ''}
                  <div style="margin-top:6px;">
                    ${priceHtml}
                    &nbsp;&nbsp;
                    ${linkHtml}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    }

    clubsHtml += `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:${color};padding:14px 16px;">
            <a href="${clubUrl}" style="color:#fff;font-size:20px;font-weight:700;text-decoration:none;">${escapeHtml(club)}</a>
            <span style="color:rgba(255,255,255,0.7);font-size:13px;margin-left:8px;">${clubEvents.length} wydarzeń</span>
          </td>
        </tr>
        ${eventsHtml}
      </table>`;
  }

  return `
    <!DOCTYPE html>
    <html lang="pl">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
        <tr>
          <td align="center" style="padding:20px;">
            <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);background-color:#1a1a2e;padding:30px 24px;border-radius:8px 8px 0 0;text-align:center;">
                  <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px;">🎵 Koncerty w Krakowie</div>
                  <div style="font-size:14px;color:rgba(255,255,255,0.7);">${formatDatePL(startDate)} — ${formatDatePL(endDate)}</div>
                  <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:8px;">Klub Re • Alchemia • Hype Park • Klub Kwadrat</div>
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td style="background:#fff;padding:24px;border-radius:0 0 8px 8px;">
                  ${events.length > 0 ? clubsHtml : '<p style="text-align:center;color:#999;font-size:16px;padding:40px 0;">Brak koncertów w tym okresie 😔</p>'}
                  <!-- Footer -->
                  <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #eee;color:#999;font-size:12px;">
                    Newsletter generowany automatycznie co poniedziałek.<br>
                    Dane pochodzą ze stron klubów i serwisów biletowych.<br>
                    Sprawdź aktualne informacje na stronach klubów.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// WYSYŁKA EMAILA
// ============================================================

function sendEmail(htmlBody, date) {
  const subject = CONFIG.EMAIL_SUBJECT_PREFIX + ' — ' + formatDateShortPL(date);

  MailApp.sendEmail({
    to: CONFIG.EMAIL_RECIPIENTS,
    subject: subject,
    htmlBody: htmlBody,
    name: CONFIG.SENDER_NAME,
  });
}

// ============================================================
// TRIGGER / HARMONOGRAM
// ============================================================

/**
 * Ustaw automatyczne wysyłanie co poniedziałek.
 * Uruchom tę funkcję raz ręcznie w Apps Script.
 */
function setupWeeklyTrigger() {
  // Usuń istniejące triggery tej funkcji
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendConcertNewsletter') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Nowy trigger: poniedziałek, 8:00-9:00
  ScriptApp.newTrigger('sendConcertNewsletter')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  Logger.log('Trigger ustawiony: poniedziałek 8:00-9:00');
}

/**
 * Funkcja testowa - uruchom ręcznie aby sprawdzić newsletter
 * bez wysyłania emaila.
 */
function testFetchEvents() {
  const today = new Date();
  const endDate = new Date(today.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);

  Logger.log('=== TEST: Pobieranie koncertów ===');
  Logger.log('Od: ' + formatDatePL(today));
  Logger.log('Do: ' + formatDatePL(endDate));

  const sources = [
    { name: 'Alchemia', fn: fetchAlchemiaEvents },
    { name: 'Klub Re', fn: fetchKlubReEvents },
    { name: 'Klub Kwadrat', fn: fetchKlubKwadratEvents },
    { name: 'Hype Park', fn: fetchHypeParkEvents },
  ];

  let totalEvents = 0;
  for (const source of sources) {
    try {
      const events = source.fn(today, endDate);
      Logger.log('\n--- ' + source.name + ' (' + events.length + ' wydarzeń) ---');
      for (const e of events) {
        Logger.log('  ' + (e.dateText || '?') + ' | ' + e.title + ' | ' + (e.price || 'brak ceny') + ' | ' + e.link);
      }
      totalEvents += events.length;
    } catch (e) {
      Logger.log('BŁĄD ' + source.name + ': ' + e.message);
    }
  }

  Logger.log('\n=== Razem: ' + totalEvents + ' wydarzeń ===');
}

/**
 * Wyślij testowy newsletter na swój email.
 */
function sendTestNewsletter() {
  sendConcertNewsletter();
}
