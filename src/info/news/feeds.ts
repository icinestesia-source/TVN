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
  { id: 'channel4-top', publisher: 'Channel 4 News', category: 'top', feedUrl: 'https://www.channel4.com/news/feed' },
  { id: 'npr-top', publisher: 'NPR', category: 'top', feedUrl: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'aljazeera-top', publisher: 'Al Jazeera English', category: 'top', feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'france24-top', publisher: 'France 24', category: 'top', feedUrl: 'https://www.france24.com/en/rss' },

  // UK
  { id: 'bbc-uk', publisher: 'BBC News', category: 'uk', feedUrl: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
  { id: 'guardian-uk', publisher: 'The Guardian', category: 'uk', feedUrl: 'https://www.theguardian.com/uk-news/rss' },
  { id: 'sky-uk', publisher: 'Sky News', category: 'uk', feedUrl: 'https://feeds.skynews.com/feeds/rss/uk.xml' },
  { id: 'independent-uk', publisher: 'The Independent', category: 'uk', feedUrl: 'https://www.independent.co.uk/news/uk/rss' },
  { id: 'channel4-uk', publisher: 'Channel 4 News', category: 'uk', feedUrl: 'https://www.channel4.com/news/feed' },
  { id: 'standard-uk', publisher: 'Evening Standard', category: 'uk', feedUrl: 'https://www.standard.co.uk/rss' },
  { id: 'mail-uk', publisher: 'Daily Mail', category: 'uk', feedUrl: 'https://www.dailymail.co.uk/articles.rss' },
  { id: 'metro-uk', publisher: 'Metro', category: 'uk', feedUrl: 'https://metro.co.uk/feed/' },
  { id: 'inews-uk', publisher: 'i', category: 'uk', feedUrl: 'https://inews.co.uk/feed' },
  { id: 'scotsman-uk', publisher: 'The Scotsman', category: 'uk', feedUrl: 'https://www.scotsman.com/rss' },
  { id: 'herald-uk', publisher: 'The Herald', category: 'uk', feedUrl: 'https://www.heraldscotland.com/news/rss/' },
  { id: 'wales-uk', publisher: 'WalesOnline', category: 'uk', feedUrl: 'https://www.walesonline.co.uk/news/?service=rss' },
  { id: 'belfast-uk', publisher: 'Belfast Telegraph', category: 'uk', feedUrl: 'https://www.belfasttelegraph.co.uk/news/rss' },
  { id: 'statesman-uk', publisher: 'New Statesman', category: 'uk', feedUrl: 'https://www.newstatesman.com/feed' },
  { id: 'conversation-uk', publisher: 'The Conversation', category: 'uk', feedUrl: 'https://theconversation.com/uk/articles.atom' },
  { id: 'opendemocracy-uk', publisher: 'openDemocracy', category: 'uk', feedUrl: 'https://www.opendemocracy.net/en/feed/' },
  { id: 'sun-uk', publisher: 'The Sun', category: 'uk', feedUrl: 'https://www.thesun.co.uk/news/uknews/feed/' },
  { id: 'ft-uk', publisher: 'Financial Times', category: 'uk', feedUrl: 'https://www.ft.com/?format=rss' },
  { id: 'gbnews-uk', publisher: 'GB News', category: 'uk', feedUrl: 'https://www.gbnews.com/feeds/news.rss' },
  { id: 'bbc-scotland', publisher: 'BBC Scotland', category: 'uk', feedUrl: 'https://feeds.bbci.co.uk/news/scotland/rss.xml' },
  { id: 'bbc-wales', publisher: 'BBC Wales', category: 'uk', feedUrl: 'https://feeds.bbci.co.uk/news/wales/rss.xml' },
  { id: 'bbc-ni', publisher: 'BBC News NI', category: 'uk', feedUrl: 'https://feeds.bbci.co.uk/news/northern_ireland/rss.xml' },

  // World
  { id: 'bbc-world', publisher: 'BBC News', category: 'world', feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'guardian-world', publisher: 'The Guardian', category: 'world', feedUrl: 'https://www.theguardian.com/world/rss' },
  { id: 'sky-world', publisher: 'Sky News', category: 'world', feedUrl: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { id: 'aljazeera-english', publisher: 'Al Jazeera English', category: 'world', feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'france24-en', publisher: 'France 24', category: 'world', feedUrl: 'https://www.france24.com/en/rss' },
  { id: 'npr-world', publisher: 'NPR', category: 'world', feedUrl: 'https://feeds.npr.org/1004/rss.xml' },
  { id: 'pbs-world', publisher: 'PBS News', category: 'world', feedUrl: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
  { id: 'abc-au-world', publisher: 'ABC News Australia', category: 'world', feedUrl: 'https://www.abc.net.au/news/feed/51120/rss.xml' },
  { id: 'cbc-world', publisher: 'CBC', category: 'world', feedUrl: 'https://www.cbc.ca/webfeed/rss/rss-world' },
  { id: 'scmp-world', publisher: 'South China Morning Post', category: 'world', feedUrl: 'https://www.scmp.com/rss/91/feed' },
  { id: 'toi-world', publisher: 'The Times of India', category: 'world', feedUrl: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms' },
  { id: 'hindu-world', publisher: 'The Hindu', category: 'world', feedUrl: 'https://www.thehindu.com/news/international/feeder/default.rss' },
  { id: 'africanews-world', publisher: 'Africanews', category: 'world', feedUrl: 'https://www.africanews.com/feed/rss' },
  { id: 'un-world', publisher: 'UN News', category: 'world', feedUrl: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml' },
  { id: 'cbs-world', publisher: 'CBS News', category: 'world', feedUrl: 'https://www.cbsnews.com/latest/rss/world' },
  { id: 'nbc-world', publisher: 'NBC News', category: 'world', feedUrl: 'https://feeds.nbcnews.com/nbcnews/public/world' },
  { id: 'abc-us-world', publisher: 'ABC News', category: 'world', feedUrl: 'https://abcnews.go.com/abcnews/internationalheadlines' },
  { id: 'nyt-world', publisher: 'The New York Times', category: 'world', feedUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { id: 'rte-world', publisher: 'RTÉ', category: 'world', feedUrl: 'https://www.rte.ie/feeds/rss/?index=/news/world/' },
  { id: 'irishtimes-world', publisher: 'The Irish Times', category: 'world', feedUrl: 'https://www.irishtimes.com/cmlink/news-1.1319192' },
  { id: 'lemonde-world', publisher: 'Le Monde', category: 'world', feedUrl: 'https://www.lemonde.fr/en/rss/une.xml' },
  { id: 'spiegel-world', publisher: 'Der Spiegel', category: 'world', feedUrl: 'https://www.spiegel.de/international/index.rss' },
  { id: 'cna-world', publisher: 'CNA', category: 'world', feedUrl: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml' },
  { id: 'dw-world', publisher: 'Deutsche Welle', category: 'world', feedUrl: 'https://rss.dw.com/rdf/rss-en-world' },
  { id: 'restofworld', publisher: 'Rest of World', category: 'world', feedUrl: 'https://restofworld.org/feed/' },
  { id: 'japantimes-world', publisher: 'The Japan Times', category: 'world', feedUrl: 'https://www.japantimes.co.jp/feed/' },
  { id: 'globe-world', publisher: 'The Globe and Mail', category: 'world', feedUrl: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/world/' },
  { id: 'straitstimes-world', publisher: 'The Straits Times', category: 'world', feedUrl: 'https://www.straitstimes.com/news/world/rss.xml' },
  { id: 'ht-world', publisher: 'Hindustan Times', category: 'world', feedUrl: 'https://www.hindustantimes.com/feeds/rss/world-news/rssfeed.xml' },
  { id: 'elpais-world', publisher: 'El País', category: 'world', feedUrl: 'https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada' },

  // Europe
  { id: 'bbc-europe', publisher: 'BBC News', category: 'europe', feedUrl: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
  { id: 'guardian-europe', publisher: 'The Guardian', category: 'europe', feedUrl: 'https://www.theguardian.com/world/europe-news/rss' },
  { id: 'dw-europe', publisher: 'Deutsche Welle', category: 'europe', feedUrl: 'https://rss.dw.com/rdf/rss-en-eu' },
  { id: 'euronews', publisher: 'Euronews', category: 'europe', feedUrl: 'https://www.euronews.com/rss' },
  { id: 'politico-eu', publisher: 'Politico', category: 'europe', feedUrl: 'https://www.politico.eu/feed/' },

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
