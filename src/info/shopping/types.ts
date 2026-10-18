/** Provider-independent shopping models and Virtual Mall foundation (no 3D). */

export type ShoppingDepartmentId =
  | 'electronics'
  | 'computing'
  | 'books'
  | 'music'
  | 'film-television'
  | 'gaming'
  | 'fashion'
  | 'home'
  | 'hobbies'
  | 'collectibles'
  | 'food-drink'
  | 'other'

export interface ShoppingDepartment {
  id: ShoppingDepartmentId
  label: string
}

export const SHOPPING_DEPARTMENTS: readonly ShoppingDepartment[] = [
  { id: 'electronics', label: 'Electronics' },
  { id: 'computing', label: 'Computing' },
  { id: 'books', label: 'Books' },
  { id: 'music', label: 'Music' },
  { id: 'film-television', label: 'Film and Television' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'fashion', label: 'Fashion' },
  { id: 'home', label: 'Home' },
  { id: 'hobbies', label: 'Hobbies' },
  { id: 'collectibles', label: 'Collectibles' },
  { id: 'food-drink', label: 'Food and Drink' },
  { id: 'other', label: 'Other' },
]

export interface Retailer {
  id: string
  name: string
  description: string
  department: ShoppingDepartmentId
  websiteUrl: string
  /** Authorised logo URL only — never invent assets. */
  logoUrl: string | null
  /** Optional product feed URL (documented/allowlisted only). */
  productFeedUrl: string | null
  /** Optional TVN channel number for Shopping TV. */
  channelNumber: number | null
  /** Official TVN partnership claim — only true when configured. */
  officialPartner: boolean
  /** Future Virtual Mall shopfront reference (no 3D assets required). */
  mall: MallShopfrontMeta
  source: 'catalogue' | 'user'
}

export interface Product {
  id: string
  retailerId: string
  title: string
  description: string
  department: ShoppingDepartmentId
  imageUrl: string | null
  price: number | null
  currency: string | null
  productUrl: string
  availability: 'unknown' | 'in-stock' | 'out-of-stock' | 'preorder' | null
  updatedIso: string | null
  dataSource: string
}

/** Minimal reusable model for a future Three.js mall — data only, no renderer. */
export interface MallShopfrontMeta {
  departmentZone: ShoppingDepartmentId
  shopfrontLabel: string
  catalogueRetailerId: string
  /** Optional future asset key — never required for INFO Shopping. */
  futureAssetRef: string | null
}

export interface UserShop {
  id: string
  name: string
  websiteUrl: string
  department: ShoppingDepartmentId
  description: string
  favourite: boolean
}

export interface ShoppingPreferences {
  favouriteShopIds: string[]
  favouriteProductIds: string[]
  favouriteDepartments: ShoppingDepartmentId[]
  userShops: UserShop[]
  departmentOrder: ShoppingDepartmentId[]
  showOfficialOnly: boolean
}

export const SHOPPING_DISCLAIMER =
  'Shopping lists curated and user-saved shops. External sites open separately. TVN does not process payments or invent prices.'
