/**
 * Future catalogue import. V0.1 does not call YouTube data APIs and does not scrape.
 * A later importer should use a permitted public mechanism, then hand plain
 * programme drafts to the catalogue. The scheduler never sees the source API.
 */

export interface ProgrammeDraft {
  title: string
  videoId: string
  durationSeconds?: number
  description?: string
  publishedAt?: string
  thumbnail?: string
  source: 'imported'
}

export interface VideoImportRequest {
  videoId: string
}

export interface PlaylistImportRequest {
  playlistId: string
}

export interface ChannelImportRequest {
  youtubeChannelId: string
}

export interface CatalogueImporter {
  importVideo(request: VideoImportRequest): Promise<ProgrammeDraft>
  importPlaylist(request: PlaylistImportRequest): Promise<ProgrammeDraft[]>
  importChannel(request: ChannelImportRequest): Promise<ProgrammeDraft[]>
}

const NOT_READY =
  'Import is not part of V0.1. Add a permitted public source later; do not scrape.'

export class PendingCatalogueImporter implements CatalogueImporter {
  importVideo(_request: VideoImportRequest): Promise<ProgrammeDraft> {
    return Promise.reject(new Error(NOT_READY))
  }

  importPlaylist(_request: PlaylistImportRequest): Promise<ProgrammeDraft[]> {
    return Promise.reject(new Error(NOT_READY))
  }

  importChannel(_request: ChannelImportRequest): Promise<ProgrammeDraft[]> {
    return Promise.reject(new Error(NOT_READY))
  }
}

export const catalogueImporter: CatalogueImporter = new PendingCatalogueImporter()
