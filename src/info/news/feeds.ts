import type { NewsCategory } from './types.ts'

/**
 * Allowlisted public RSS/Atom feeds for INFO → News.
 * Publishers document these URLs; TVN stores headlines and links only, never full articles.
 * Space-focused and religious feeds are excluded from the default set.
 * Reuters and AP closed or restrict public RSS — not included as publisher feeds.
 */
export interface NewsFeed {
  id: string
  publisher: string
  category: NewsCategory
  feedUrl: string
}

export const NEWS_FEEDS: readonly NewsFeed[] = [
  // Top stories
  { id: 'bbc-top', publisher: 'BBC News', category: 'top', feedUrl: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'guardian-top', publisher: 'The Guardian', category: 'top', feedUrl: 'https://www.theguardian.com/uk/rss' },
  { id: 'sky-home', publisher: 'Sky News', category: 'top', feedUrl: 'https://feeds.skynews.com/feeds/rss/home.xml' },
  { id: 'independent-top', publisher: 'The Independent', category: 'top', feedUrl: 'https://www.independent.co.uk/rss' },

  // UK
  { id: 'bbc-uk', publisher: 'BBC News', category: 'uk', feedUrl: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
  { id: 'guardian-uk', publisher: 'The Guardian', category: 'uk', feedUrl: 'https://www.theguardian.com/uk-news/rss' },
  { id: 'sky-uk', publisher: 'Sky News', category: 'uk', feedUrl: 'https://feeds.skynews.com/feeds/rss/uk.xml' },
  { id: 'independent-uk', publisher: 'The Independent', category: 'uk', feedUrl: 'https://www.independent.co.uk/news/uk/rss' },

  // World
  { id: 'bbc-world', publisher: 'BBC News', category: 'world', feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'guardian-world', publisher: 'The Guardian', category: 'world', feedUrl: 'https://www.theguardian.com/world/rss' },
  { id: 'sky-world', publisher: 'Sky News', category: 'world', feedUrl: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { id: 'aljazeera-english', publisher: 'Al Jazeera English', category: 'world', feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'france24-en', publisher: 'France 24', category: 'world', feedUrl: 'https://www.france24.com/en/rss' },

  // Europe
  { id: 'bbc-europe', publisher: 'BBC News', category: 'europe', feedUrl: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
  { id: 'guardian-europe', publisher: 'The Guardian', category: 'europe', feedUrl: 'https://www.theguardian.com/world/europe-news/rss' },
  { id: 'dw-europe', publisher: 'Deutsche Welle', category: 'europe', feedUrl: 'https://rss.dw.com/rdf/rss-en-eu' },
  { id: 'euronews', publisher: 'Euronews', category: 'europe', feedUrl: 'https://www.euronews.com/rss' },

  // Technology
  { id: 'bbc-tech', publisher: 'BBC News', category: 'technology', feedUrl: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { id: 'guardian-tech', publisher: 'The Guardian', category: 'technology', feedUrl: 'https://www.theguardian.com/uk/technology/rss' },
  { id: 'ars-technica', publisher: 'Ars Technica', category: 'technology', feedUrl: 'https://feeds.arstechnica.com/arstechnica/index' },
  { id: 'the-register', publisher: 'The Register', category: 'technology', feedUrl: 'https://www.theregister.com/headlines.atom' },

  // Science (not space-only specialty feeds)
  { id: 'bbc-science', publisher: 'BBC News', category: 'science', feedUrl: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
  { id: 'guardian-science', publisher: 'The Guardian', category: 'science', feedUrl: 'https://www.theguardian.com/science/rss' },
  { id: 'new-scientist', publisher: 'New Scientist', category: 'science', feedUrl: 'https://www.newscientist.com/feed/home/' },

  // Business
  { id: 'bbc-business', publisher: 'BBC News', category: 'business', feedUrl: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { id: 'guardian-business', publisher: 'The Guardian', category: 'business', feedUrl: 'https://www.theguardian.com/uk/business/rss' },
  { id: 'sky-business', publisher: 'Sky News', category: 'business', feedUrl: 'https://feeds.skynews.com/feeds/rss/business.xml' },

  // Culture
  { id: 'guardian-culture', publisher: 'The Guardian', category: 'culture', feedUrl: 'https://www.theguardian.com/uk/culture/rss' },
  { id: 'bbc-arts', publisher: 'BBC News', category: 'culture', feedUrl: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },

  // Entertainment
  { id: 'bbc-entertainment', publisher: 'BBC News', category: 'entertainment', feedUrl: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  { id: 'guardian-tv', publisher: 'The Guardian', category: 'entertainment', feedUrl: 'https://www.theguardian.com/uk/tv-and-radio/rss' },
  { id: 'sky-entertainment', publisher: 'Sky News', category: 'entertainment', feedUrl: 'https://feeds.skynews.com/feeds/rss/entertainment.xml' },
]
