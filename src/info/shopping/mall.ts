import { RETAILERS } from './catalogue.ts'
import type { MallShopfrontMeta, Retailer, ShoppingDepartmentId } from './types.ts'
import { SHOPPING_DEPARTMENTS } from './types.ts'

/**
 * Virtual Mall foundation — department zones and shopfront metadata only.
 * No Three.js, no 3D assets, no immersive navigation.
 */
export interface MallDepartmentZone {
  id: ShoppingDepartmentId
  label: string
  shopfronts: MallShopfrontMeta[]
}

export function mallDepartmentZones(retailers: readonly Retailer[] = RETAILERS): MallDepartmentZone[] {
  return SHOPPING_DEPARTMENTS.map((department) => ({
    id: department.id,
    label: department.label,
    shopfronts: retailers.filter((entry) => entry.department === department.id).map((entry) => entry.mall),
  })).filter((zone) => zone.shopfronts.length > 0)
}

export const MALL_STATUS_NOTE =
  'An immersive Virtual Mall is planned for a later phase. This section lists department zones and shopfronts from the same catalogue — it is not a 3D experience yet.'
