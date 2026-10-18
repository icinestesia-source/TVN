import { useMemo, useState } from 'react'
import { CATALOGUE_PRODUCTS, RETAILERS, retailerById, searchProducts, searchRetailers } from '../../info/shopping/catalogue.ts'
import { MALL_STATUS_NOTE, mallDepartmentZones } from '../../info/shopping/mall.ts'
import { shoppingTvLink } from '../../info/shopping/tvn-link.ts'
import {
  SHOPPING_DEPARTMENTS,
  SHOPPING_DISCLAIMER,
  type Product,
  type Retailer,
  type ShoppingDepartmentId,
  type UserShop,
} from '../../info/shopping/types.ts'
import { userShopId, validateShopUrl } from '../../info/shopping/validate.ts'
import { defaultInfoPreferences, loadInfoPreferences, saveInfoPreferences, type InfoPreferences } from '../../info/preferences.ts'
import { keepKey } from '../keep-key.ts'

type Section = 'discover' | 'departments' | 'shops' | 'products' | 'favourites' | 'shopping-tv' | 'mall'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'departments', label: 'Departments' },
  { id: 'shops', label: 'Shops' },
  { id: 'products', label: 'Products' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'shopping-tv', label: 'Shopping TV' },
  { id: 'mall', label: 'Mall' },
]

function departmentLabel(id: ShoppingDepartmentId): string {
  return SHOPPING_DEPARTMENTS.find((entry) => entry.id === id)?.label ?? id
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="tab" href={href} target="_blank" rel="noopener noreferrer">
      {children} (external)
    </a>
  )
}

function RetailerRow({
  retailer,
  favourite,
  onToggleFavourite,
}: {
  retailer: Retailer
  favourite: boolean
  onToggleFavourite: () => void
}) {
  const tv = shoppingTvLink(retailer)
  return (
    <li className="info-item">
      <span className="info-item-title">{retailer.name}</span>
      <p className="info-item-desc">{retailer.description}</p>
      <span className="info-item-meta">
        {departmentLabel(retailer.department)}
        {retailer.officialPartner ? ' · TVN partner' : ' · Directory listing only'}
        {retailer.source === 'user' ? ' · Added by you' : ''}
      </span>
      <div className="info-weather-search-row">
        <ExternalLink href={retailer.websiteUrl}>Website</ExternalLink>
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onToggleFavourite}>
          {favourite ? 'Favourited' : 'Favourite'}
        </button>
        {tv ? (
          <span className="info-item-meta">
            Watch on TVN · ch {tv.channelNumber} {tv.channelName}
          </span>
        ) : null}
      </div>
    </li>
  )
}

export function ShoppingPanel() {
  const [prefs, setPrefs] = useState<InfoPreferences>(() => {
    try {
      return loadInfoPreferences()
    } catch {
      return defaultInfoPreferences()
    }
  })
  const [section, setSection] = useState<Section>('discover')
  const [query, setQuery] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState<ShoppingDepartmentId | 'all'>('all')
  const [formError, setFormError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: '',
    websiteUrl: '',
    department: 'other' as ShoppingDepartmentId,
    description: '',
  })

  const persist = (next: InfoPreferences) => {
    saveInfoPreferences(next)
    setPrefs(next)
  }

  const shopping = prefs.shopping
  const orderedDepartments = useMemo(() => {
    const order = shopping.departmentOrder
    return [
      ...order.map((id) => SHOPPING_DEPARTMENTS.find((entry) => entry.id === id)).filter(Boolean),
      ...SHOPPING_DEPARTMENTS.filter((entry) => !order.includes(entry.id)),
    ] as typeof SHOPPING_DEPARTMENTS
  }, [shopping.departmentOrder])

  const hasOfficialPartners = RETAILERS.some((entry) => entry.officialPartner)

  const allRetailers = useMemo(() => {
    const catalogue =
      shopping.showOfficialOnly && hasOfficialPartners
        ? RETAILERS.filter((entry) => entry.officialPartner)
        : [...RETAILERS]
    const userAsRetailers: Retailer[] = shopping.userShops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      description: shop.description || 'Shop saved by you. Not an official TVN integration.',
      department: shop.department,
      websiteUrl: shop.websiteUrl,
      logoUrl: null,
      productFeedUrl: null,
      channelNumber: null,
      officialPartner: false,
      mall: {
        departmentZone: shop.department,
        shopfrontLabel: shop.name,
        catalogueRetailerId: shop.id,
        futureAssetRef: null,
      },
      source: 'user' as const,
    }))
    return [...catalogue, ...userAsRetailers]
  }, [shopping.showOfficialOnly, shopping.userShops, hasOfficialPartners])

  const filteredRetailers = useMemo(() => {
    const byDept =
      departmentFilter === 'all' ? allRetailers : allRetailers.filter((entry) => entry.department === departmentFilter)
    return searchRetailers(query, byDept)
  }, [allRetailers, departmentFilter, query])

  const products = useMemo(() => {
    const list =
      departmentFilter === 'all'
        ? [...CATALOGUE_PRODUCTS]
        : CATALOGUE_PRODUCTS.filter((product) => product.department === departmentFilter)
    return searchProducts(query, list)
  }, [departmentFilter, query])

  const toggleShopFavourite = (id: string) => {
    const set = new Set(shopping.favouriteShopIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    const userShops = shopping.userShops.map((shop) => (shop.id === id ? { ...shop, favourite: set.has(id) } : shop))
    persist({ ...prefs, shopping: { ...shopping, favouriteShopIds: [...set], userShops } })
  }

  const toggleProductFavourite = (id: string) => {
    const set = new Set(shopping.favouriteProductIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    persist({ ...prefs, shopping: { ...shopping, favouriteProductIds: [...set] } })
  }

  const toggleDepartmentFavourite = (id: ShoppingDepartmentId) => {
    const set = new Set(shopping.favouriteDepartments)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    persist({ ...prefs, shopping: { ...shopping, favouriteDepartments: [...set] } })
  }

  const moveInList = <T,>(list: T[], index: number, delta: number): T[] => {
    const next = [...list]
    const target = index + delta
    if (target < 0 || target >= next.length) return list
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item!)
    return next
  }

  const saveUserShop = () => {
    const name = draft.name.trim()
    if (!name) {
      setFormError('Enter a shop name.')
      return
    }
    const checked = validateShopUrl(draft.websiteUrl)
    if (!checked.ok) {
      setFormError(checked.error)
      return
    }
    const shop: UserShop = {
      id: editId ?? userShopId(name, checked.url),
      name,
      websiteUrl: checked.url,
      department: draft.department,
      description: draft.description.trim(),
      favourite: editId
        ? (shopping.userShops.find((entry) => entry.id === editId)?.favourite ?? false)
        : true,
    }
    let userShops: UserShop[]
    let favouriteShopIds = [...shopping.favouriteShopIds]
    if (editId) {
      userShops = shopping.userShops.map((entry) => (entry.id === editId ? shop : entry))
    } else {
      if (shopping.userShops.some((entry) => entry.id === shop.id || entry.websiteUrl === shop.websiteUrl)) {
        setFormError('That shop is already saved.')
        return
      }
      userShops = [...shopping.userShops, shop]
      if (!favouriteShopIds.includes(shop.id)) favouriteShopIds = [...favouriteShopIds, shop.id]
    }
    persist({ ...prefs, shopping: { ...shopping, userShops, favouriteShopIds } })
    setDraft({ name: '', websiteUrl: '', department: 'other', description: '' })
    setEditId(null)
    setFormError(null)
  }

  const startEdit = (shop: UserShop) => {
    setEditId(shop.id)
    setDraft({
      name: shop.name,
      websiteUrl: shop.websiteUrl,
      department: shop.department,
      description: shop.description,
    })
    setFormError(null)
    setSection('shops')
  }

  const removeUserShop = (id: string) => {
    persist({
      ...prefs,
      shopping: {
        ...shopping,
        userShops: shopping.userShops.filter((shop) => shop.id !== id),
        favouriteShopIds: shopping.favouriteShopIds.filter((entry) => entry !== id),
      },
    })
    if (editId === id) {
      setEditId(null)
      setDraft({ name: '', websiteUrl: '', department: 'other', description: '' })
    }
  }

  const favouriteShops = allRetailers.filter((entry) => shopping.favouriteShopIds.includes(entry.id))
  const favouriteProducts = CATALOGUE_PRODUCTS.filter((product) => shopping.favouriteProductIds.includes(product.id))
  const tvRetailers = allRetailers.filter((entry) => shoppingTvLink(entry))
  const mallZones = mallDepartmentZones(RETAILERS)

  return (
    <div className="info-panel">
      <div className="tabs" role="tablist" aria-label="Shopping sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            className={section === entry.id ? 'tab is-on' : 'tab'}
            onKeyDown={keepKey}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === 'discover' || section === 'shops' || section === 'products' || section === 'departments' ? (
        <div className="info-weather-search">
          <div className="info-weather-search-row">
            <input
              className="info-weather-input"
              type="search"
              placeholder={section === 'products' ? 'Search products' : 'Search shops'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search shopping"
            />
            <select
              className="info-weather-input"
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value as ShoppingDepartmentId | 'all')}
              aria-label="Department filter"
            >
              <option value="all">All departments</option>
              {orderedDepartments.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            {hasOfficialPartners ? (
              <label className="info-item-meta">
                <input
                  type="checkbox"
                  checked={shopping.showOfficialOnly}
                  onChange={(event) =>
                    persist({ ...prefs, shopping: { ...shopping, showOfficialOnly: event.target.checked } })
                  }
                />{' '}
                Official partners only
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      {section === 'discover' ? (
        <>
          <p className="options-note">{SHOPPING_DISCLAIMER}</p>
          <p className="options-note">Browse curated public retailers and shops you add yourself. No prices are invented.</p>
          <ul className="info-list">
            {filteredRetailers.slice(0, 12).map((retailer) => (
              <RetailerRow
                key={retailer.id}
                retailer={retailer}
                favourite={shopping.favouriteShopIds.includes(retailer.id)}
                onToggleFavourite={() => toggleShopFavourite(retailer.id)}
              />
            ))}
          </ul>
          {filteredRetailers.length === 0 ? <p className="options-note">No shops match that search.</p> : null}
        </>
      ) : null}

      {section === 'departments' ? (
        <ul className="info-list">
          {orderedDepartments.map((department, index) => {
            const count = allRetailers.filter((entry) => entry.department === department.id).length
            return (
              <li key={department.id} className="info-item">
                <span className="info-item-title">{department.label}</span>
                <span className="info-item-meta">
                  {count} shop{count === 1 ? '' : 's'} · configurable catalogue department
                </span>
                <div className="info-weather-search-row">
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => toggleDepartmentFavourite(department.id)}>
                    {shopping.favouriteDepartments.includes(department.id) ? 'Favourited' : 'Favourite'}
                  </button>
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    disabled={index === 0}
                    onClick={() =>
                      persist({
                        ...prefs,
                        shopping: { ...shopping, departmentOrder: moveInList([...shopping.departmentOrder], index, -1) },
                      })
                    }
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    disabled={index === orderedDepartments.length - 1}
                    onClick={() =>
                      persist({
                        ...prefs,
                        shopping: { ...shopping, departmentOrder: moveInList([...shopping.departmentOrder], index, 1) },
                      })
                    }
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="tab"
                    onKeyDown={keepKey}
                    onClick={() => {
                      setDepartmentFilter(department.id)
                      setSection('shops')
                    }}
                  >
                    Browse shops
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {section === 'shops' ? (
        <>
          <div className="info-weather-search">
            <p className="options-note">Add a shop you like. TVN stores it locally and does not fetch the website for you.</p>
            <div className="info-weather-search-row">
              <input
                className="info-weather-input"
                placeholder="Shop name"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                aria-label="Shop name"
              />
              <input
                className="info-weather-input"
                placeholder="https://example.com"
                value={draft.websiteUrl}
                onChange={(event) => setDraft((prev) => ({ ...prev, websiteUrl: event.target.value }))}
                aria-label="Shop website URL"
              />
              <select
                className="info-weather-input"
                value={draft.department}
                onChange={(event) => setDraft((prev) => ({ ...prev, department: event.target.value as ShoppingDepartmentId }))}
                aria-label="Shop department"
              >
                {SHOPPING_DEPARTMENTS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="info-weather-input"
              placeholder="Optional description"
              value={draft.description}
              onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
              aria-label="Shop description"
            />
            <div className="info-weather-search-row">
              <button type="button" className="tab" onKeyDown={keepKey} onClick={saveUserShop}>
                {editId ? 'Save changes' : 'Add shop'}
              </button>
              {editId ? (
                <button
                  type="button"
                  className="tab"
                  onKeyDown={keepKey}
                  onClick={() => {
                    setEditId(null)
                    setDraft({ name: '', websiteUrl: '', department: 'other', description: '' })
                    setFormError(null)
                  }}
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
            {formError ? <p className="options-note">{formError}</p> : null}
          </div>
          {shopping.userShops.length ? (
            <ul className="info-list">
              {shopping.userShops.map((shop, index) => (
                <li key={shop.id} className="info-item">
                  <span className="info-item-title">{shop.name}</span>
                  <p className="info-item-desc">{shop.description || 'User-added shop'}</p>
                  <span className="info-item-meta">{departmentLabel(shop.department)} · your shop</span>
                  <div className="info-weather-search-row">
                    <ExternalLink href={shop.websiteUrl}>Website</ExternalLink>
                    <button type="button" className="tab" onKeyDown={keepKey} onClick={() => startEdit(shop)}>
                      Edit
                    </button>
                    <button type="button" className="tab" onKeyDown={keepKey} onClick={() => removeUserShop(shop.id)}>
                      Remove
                    </button>
                    <button
                      type="button"
                      className="tab"
                      onKeyDown={keepKey}
                      disabled={index === 0}
                      onClick={() =>
                        persist({
                          ...prefs,
                          shopping: { ...shopping, userShops: moveInList(shopping.userShops, index, -1) },
                        })
                      }
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="tab"
                      onKeyDown={keepKey}
                      disabled={index === shopping.userShops.length - 1}
                      onClick={() =>
                        persist({
                          ...prefs,
                          shopping: { ...shopping, userShops: moveInList(shopping.userShops, index, 1) },
                        })
                      }
                    >
                      Down
                    </button>
                    <button type="button" className="tab" onKeyDown={keepKey} onClick={() => toggleShopFavourite(shop.id)}>
                      {shopping.favouriteShopIds.includes(shop.id) ? 'Favourited' : 'Favourite'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="info-list">
            {filteredRetailers.map((retailer) => (
              <RetailerRow
                key={retailer.id}
                retailer={retailer}
                favourite={shopping.favouriteShopIds.includes(retailer.id)}
                onToggleFavourite={() => toggleShopFavourite(retailer.id)}
              />
            ))}
          </ul>
          {filteredRetailers.length === 0 ? <p className="options-note">No shops in this view.</p> : null}
        </>
      ) : null}

      {section === 'products' ? (
        <>
          <p className="options-note">
            Products appear only from authorised feeds or manually configured catalogue entries. Live inventory and prices are
            never scraped or invented.
          </p>
          {products.length === 0 ? (
            <p className="options-note">
              No authorised product listings are available yet. Product cards will appear here when an approved feed or curated
              catalogue entry is configured. Browse Shops in the meantime — prices and stock are never fabricated.
            </p>
          ) : (
            <ul className="info-list">
              {products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  favourite={shopping.favouriteProductIds.includes(product.id)}
                  onToggleFavourite={() => toggleProductFavourite(product.id)}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      {section === 'favourites' ? (
        <>
          <h4 className="options-head">Favourite departments</h4>
          {shopping.favouriteDepartments.length === 0 ? (
            <p className="options-note">No favourite departments yet.</p>
          ) : (
            <ul className="info-list">
              {shopping.favouriteDepartments.map((id, index) => (
                <li key={id} className="info-item">
                  <span className="info-item-title">{departmentLabel(id)}</span>
                  <div className="info-weather-search-row">
                    <button type="button" className="tab" onKeyDown={keepKey} onClick={() => toggleDepartmentFavourite(id)}>
                      Remove
                    </button>
                    <button
                      type="button"
                      className="tab"
                      onKeyDown={keepKey}
                      disabled={index === 0}
                      onClick={() =>
                        persist({
                          ...prefs,
                          shopping: {
                            ...shopping,
                            favouriteDepartments: moveInList(shopping.favouriteDepartments, index, -1),
                          },
                        })
                      }
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="tab"
                      onKeyDown={keepKey}
                      disabled={index === shopping.favouriteDepartments.length - 1}
                      onClick={() =>
                        persist({
                          ...prefs,
                          shopping: {
                            ...shopping,
                            favouriteDepartments: moveInList(shopping.favouriteDepartments, index, 1),
                          },
                        })
                      }
                    >
                      Down
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h4 className="options-head">Favourite shops</h4>
          {favouriteShops.length === 0 ? (
            <p className="options-note">No favourite shops yet.</p>
          ) : (
            <ul className="info-list">
              {shopping.favouriteShopIds.map((id, index) => {
                const retailer = favouriteShops.find((entry) => entry.id === id)
                if (!retailer) return null
                const tv = shoppingTvLink(retailer)
                return (
                  <li key={id} className="info-item">
                    <span className="info-item-title">{retailer.name}</span>
                    <p className="info-item-desc">{retailer.description}</p>
                    <span className="info-item-meta">
                      {departmentLabel(retailer.department)}
                      {retailer.source === 'user' ? ' · Added by you' : ' · Directory listing only'}
                    </span>
                    <div className="info-weather-search-row">
                      <ExternalLink href={retailer.websiteUrl}>Website</ExternalLink>
                      <button type="button" className="tab" onKeyDown={keepKey} onClick={() => toggleShopFavourite(id)}>
                        Remove
                      </button>
                      <button
                        type="button"
                        className="tab"
                        onKeyDown={keepKey}
                        disabled={index === 0}
                        onClick={() =>
                          persist({
                            ...prefs,
                            shopping: { ...shopping, favouriteShopIds: moveInList(shopping.favouriteShopIds, index, -1) },
                          })
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="tab"
                        onKeyDown={keepKey}
                        disabled={index === shopping.favouriteShopIds.length - 1}
                        onClick={() =>
                          persist({
                            ...prefs,
                            shopping: { ...shopping, favouriteShopIds: moveInList(shopping.favouriteShopIds, index, 1) },
                          })
                        }
                      >
                        Down
                      </button>
                      {tv ? (
                        <span className="info-item-meta">
                          Watch on TVN · ch {tv.channelNumber} {tv.channelName}
                        </span>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <h4 className="options-head">Favourite products</h4>
          {favouriteProducts.length === 0 ? (
            <p className="options-note">No favourite products yet. The product catalogue is empty until authorised entries are added.</p>
          ) : (
            <ul className="info-list">
              {favouriteProducts.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  favourite
                  onToggleFavourite={() => toggleProductFavourite(product.id)}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      {section === 'shopping-tv' ? (
        <>
          <p className="options-note">
            Shopping TV links only appear when a catalogue retailer references an existing playable TVN channel. Browsing here
            does not retune playback.
          </p>
          {tvRetailers.length === 0 ? (
            <p className="options-note">No shopping-channel links are configured yet. The default network and User Network are unchanged.</p>
          ) : (
            <ul className="info-list">
              {tvRetailers.map((retailer) => (
                <RetailerRow
                  key={retailer.id}
                  retailer={retailer}
                  favourite={shopping.favouriteShopIds.includes(retailer.id)}
                  onToggleFavourite={() => toggleShopFavourite(retailer.id)}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      {section === 'mall' ? (
        <>
          <p className="options-note">{MALL_STATUS_NOTE}</p>
          <ul className="info-list">
            {mallZones.map((zone) => (
              <li key={zone.id} className="info-item">
                <span className="info-item-title">{zone.label}</span>
                <span className="info-item-meta">{zone.shopfronts.length} shopfront{zone.shopfronts.length === 1 ? '' : 's'} · catalogue linked</span>
                <p className="info-item-desc">{zone.shopfronts.map((shop) => shop.shopfrontLabel).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

function ProductRow({
  product,
  favourite,
  onToggleFavourite,
}: {
  product: Product
  favourite: boolean
  onToggleFavourite: () => void
}) {
  const retailer = retailerById(product.retailerId)
  const price =
    product.price != null && product.currency
      ? `${product.currency} ${product.price.toFixed(2)}`
      : 'Price not supplied'
  return (
    <li className="info-item">
      <span className="info-item-title">{product.title}</span>
      {product.description ? <p className="info-item-desc">{product.description}</p> : null}
      <span className="info-item-meta">
        {departmentLabel(product.department)}
        {retailer ? ` · ${retailer.name}` : ''}
        {` · ${price}`}
        {product.availability ? ` · ${product.availability}` : ''}
        {` · ${product.dataSource}`}
      </span>
      <div className="info-weather-search-row">
        <ExternalLink href={product.productUrl}>Product page</ExternalLink>
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onToggleFavourite}>
          {favourite ? 'Favourited' : 'Favourite'}
        </button>
      </div>
    </li>
  )
}
