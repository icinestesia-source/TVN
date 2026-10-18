import type { NewsCategory } from './types.ts'

/**
 * Allowlisted public RSS/Atom feeds for INFO → News.
 * Publishers document these URLs; TVN stores headlines and links only, never full articles.
 */
export interface NewsFeed {
  id: string
  publisher: string
  category: NewsCategory
  feedUrl: string
}

export const NEWS_FEEDS: readonly NewsFeed[] = [
  { id: 'bbc-uk', publisher: 'BBC News', category: 'uk', feedUrl: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
  { id: 'bbc-world', publisher: 'BBC News', category: 'world', feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'bbc-tech', publisher: 'BBC News', category: 'technology', feedUrl: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { id: 'bbc-science', publisher: 'BBC News', category: 'science', feedUrl: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
  { id: 'bbc-business', publisher: 'BBC News', category: 'business', feedUrl: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { id: 'bbc-entertainment', publisher: 'BBC News', category: 'entertainment', feedUrl: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  { id: 'guardian-uk', publisher: 'The Guardian', category: 'uk', feedUrl: 'https://www.theguardian.com/uk-news/rss' },
  { id: 'guardian-world', publisher: 'The Guardian', category: 'world', feedUrl: 'https://www.theguardian.com/world/rss' },
  { id: 'guardian-tech', publisher: 'The Guardian', category: 'technology', feedUrl: 'https://www.theguardian.com/uk/technology/rss' },
  { id: 'guardian-culture', publisher: 'The Guardian', category: 'culture', feedUrl: 'https://www.theguardian.com/uk/culture/rss' },
  { id: 'guardian-business', publisher: 'The Guardian', category: 'business', feedUrl: 'https://www.theguardian.com/uk/business/rss' },
  { id: 'guardian-science', publisher: 'The Guardian', category: 'science', feedUrl: 'https://www.theguardian.com/science/rss' },
]
