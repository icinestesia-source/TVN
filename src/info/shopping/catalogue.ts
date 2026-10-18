import type { Product, Retailer, ShoppingDepartmentId } from './types.ts'

function mall(department: ShoppingDepartmentId, retailerId: string, label: string) {
  return {
    departmentZone: department,
    shopfrontLabel: label,
    catalogueRetailerId: retailerId,
    futureAssetRef: null as string | null,
  }
}

/**
 * Curated public retailer directory — not partnership claims.
 * officialPartner is false unless explicitly true for a confirmed TVN arrangement.
 */
export const RETAILERS: readonly Retailer[] = [
  {
    id: 'bbc-shop',
    name: 'BBC Shop',
    description: 'Official BBC merchandise and media.',
    department: 'film-television',
    websiteUrl: 'https://shop.bbc.com/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('film-television', 'bbc-shop', 'BBC Shop'),
    source: 'catalogue',
  },
  {
    id: 'waterstones',
    name: 'Waterstones',
    description: 'UK bookseller.',
    department: 'books',
    websiteUrl: 'https://www.waterstones.com/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('books', 'waterstones', 'Waterstones'),
    source: 'catalogue',
  },
  {
    id: 'rough-trade',
    name: 'Rough Trade',
    description: 'Independent music retailer.',
    department: 'music',
    websiteUrl: 'https://www.roughtrade.com/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('music', 'rough-trade', 'Rough Trade'),
    source: 'catalogue',
  },
  {
    id: 'game',
    name: 'GAME',
    description: 'UK games and consoles retailer.',
    department: 'gaming',
    websiteUrl: 'https://www.game.co.uk/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('gaming', 'game', 'GAME'),
    source: 'catalogue',
  },
  {
    id: 'currys',
    name: 'Currys',
    description: 'UK electronics and computing.',
    department: 'electronics',
    websiteUrl: 'https://www.currys.co.uk/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('electronics', 'currys', 'Currys'),
    source: 'catalogue',
  },
  {
    id: 'scan',
    name: 'Scan Computers',
    description: 'UK computing specialists.',
    department: 'computing',
    websiteUrl: 'https://www.scan.co.uk/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('computing', 'scan', 'Scan'),
    source: 'catalogue',
  },
  {
    id: 'ikea-uk',
    name: 'IKEA UK',
    description: 'Home furnishings.',
    department: 'home',
    websiteUrl: 'https://www.ikea.com/gb/en/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('home', 'ikea-uk', 'IKEA'),
    source: 'catalogue',
  },
  {
    id: 'hobbycraft',
    name: 'Hobbycraft',
    description: 'Crafts and hobbies.',
    department: 'hobbies',
    websiteUrl: 'https://www.hobbycraft.co.uk/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('hobbies', 'hobbycraft', 'Hobbycraft'),
    source: 'catalogue',
  },
  {
    id: 'forbidden-planet',
    name: 'Forbidden Planet',
    description: 'Comics, collectibles and geek culture.',
    department: 'collectibles',
    websiteUrl: 'https://forbiddenplanet.com/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('collectibles', 'forbidden-planet', 'Forbidden Planet'),
    source: 'catalogue',
  },
  {
    id: 'john-lewis',
    name: 'John Lewis',
    description: 'Department store — fashion, home and more.',
    department: 'fashion',
    websiteUrl: 'https://www.johnlewis.com/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('fashion', 'john-lewis', 'John Lewis'),
    source: 'catalogue',
  },
  {
    id: 'waitrose',
    name: 'Waitrose',
    description: 'UK food and drink retailer.',
    department: 'food-drink',
    websiteUrl: 'https://www.waitrose.com/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('food-drink', 'waitrose', 'Waitrose'),
    source: 'catalogue',
  },
  {
    id: 'bfi-shop',
    name: 'BFI Shop',
    description: 'British Film Institute shop — film and television media.',
    department: 'film-television',
    websiteUrl: 'https://shop.bfi.org.uk/',
    logoUrl: null,
    productFeedUrl: null,
    channelNumber: null,
    officialPartner: false,
    mall: mall('film-television', 'bfi-shop', 'BFI Shop'),
    source: 'catalogue',
  },
]

/**
 * Manually configured product entries only — no scraped inventory.
 * Empty by default until authorised feeds or curated rows are added.
 */
export const CATALOGUE_PRODUCTS: readonly Product[] = []

export function retailersByDepartment(department: ShoppingDepartmentId | 'all'): Retailer[] {
  if (department === 'all') return [...RETAILERS]
  return RETAILERS.filter((entry) => entry.department === department)
}

export function searchRetailers(query: string, list: readonly Retailer[] = RETAILERS): Retailer[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...list]
  return list.filter(
    (entry) =>
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.department.includes(q),
  )
}

export function productsForRetailer(retailerId: string, products: readonly Product[] = CATALOGUE_PRODUCTS): Product[] {
  return products.filter((product) => product.retailerId === retailerId)
}

export function searchProducts(query: string, products: readonly Product[] = CATALOGUE_PRODUCTS): Product[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...products]
  return products.filter((product) => product.title.toLowerCase().includes(q) || product.description.toLowerCase().includes(q))
}

export function retailerById(id: string): Retailer | undefined {
  return RETAILERS.find((entry) => entry.id === id)
}
