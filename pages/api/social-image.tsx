import { type NextApiRequest, type NextApiResponse } from 'next'
import { ImageResponse } from 'next/og'
import { type PageBlock } from 'notion-types'

import * as libConfig from '@/lib/config'
import { notion } from '@/lib/notion-api'
import { type NotionPageInfo, type PageError } from '@/lib/types'

export const runtime = 'edge'

export default async function OGImage(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { searchParams } = new URL(req.url!)
  const pageId = parsePageId(
    searchParams.get('id') || libConfig.rootNotionPageId
  )
  if (!pageId) {
    return new Response('Invalid notion page id', { status: 400 })
  }

  const pageInfoOrError = await getNotionPageInfo({ pageId })
  if (pageInfoOrError.type === 'error') {
    return res.status(pageInfoOrError.error.statusCode).send({
      error: pageInfoOrError.error.message
    })
  }
  const pageInfo = pageInfoOrError.data
  console.log(pageInfo)

  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1F2027',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'black'
      }}
    >
      {pageInfo.image && (
        <img
          src={pageInfo.image}
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'cover'
            // TODO: satori doesn't support background-size: cover and seems to
            // have inconsistent support for filter + transform to get rid of the
            // blurred edges. For now, we'll go without a blur filter on the
            // background, but Satori is still very new, so hopefully we can re-add
            // the blur soon.

            // backgroundImage: pageInfo.image
            //   ? `url(${pageInfo.image})`
            //   : undefined,
            // backgroundSize: '100% 100%'
            // TODO: pageInfo.imageObjectPosition
            // filter: 'blur(8px)'
            // transform: 'scale(1.05)'
          }}
        />
      )}

      <div
        style={{
          position: 'relative',
          width: 900,
          height: 465,
          display: 'flex',
          flexDirection: 'column',
          border: '16px solid rgba(0,0,0,0.3)',
          borderRadius: 8,
          zIndex: '1'
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-around',
            backgroundColor: '#fff',
            padding: 24,
            alignItems: 'center',
            textAlign: 'center'
          }}
        >
          {pageInfo.detail && (
            <div style={{ fontSize: 32, opacity: 0 }}>{pageInfo.detail}</div>
          )}

          <div
            style={{
              fontSize: 70,
              fontWeight: 700,
              fontFamily: 'system-ui, sans-serif'
            }}
          >
            {pageInfo.title}
          </div>

          {pageInfo.detail && (
            <div style={{ fontSize: 32, opacity: 0.6 }}>{pageInfo.detail}</div>
          )}
        </div>
      </div>

      {pageInfo.authorImage && (
        <div
          style={{
            position: 'absolute',
            top: 47,
            left: 104,
            height: 128,
            width: 128,
            display: 'flex',
            borderRadius: '50%',
            border: '4px solid #fff',
            zIndex: '5'
          }}
        >
          <img
            src={pageInfo.authorImage}
            style={{
              width: '100%',
              height: '100%'
              // transform: 'scale(1.04)'
            }}
          />
        </div>
      )}
    </div>,
    {
      width: 1200,
      height: 630
    }
  )
}

export async function getNotionPageInfo({
  pageId
}: {
  pageId: string
}): Promise<
  | { type: 'success'; data: NotionPageInfo }
  | { type: 'error'; error: PageError }
> {
  const recordMap = await notion.getPage(pageId)

  const keys = Object.keys(recordMap?.block || {})
  const block = getBlockValue(recordMap?.block?.[keys[0]!])

  if (!block) {
    throw new Error('Invalid recordMap for page')
  }

  const blockSpaceId = block.space_id

  if (
    blockSpaceId &&
    libConfig.rootNotionSpaceId &&
    blockSpaceId !== libConfig.rootNotionSpaceId
  ) {
    return {
      type: 'error',
      error: {
        statusCode: 400,
        message: `Notion page "${pageId}" belongs to a different workspace.`
      }
    }
  }

  const isBlogPost =
    block.type === 'page' && block.parent_table === 'collection'
  const title = getBlockTitle(block) || libConfig.name

  const imageCoverPosition =
    (block as PageBlock).format?.page_cover_position ??
    libConfig.defaultPageCoverPosition
  const imageObjectPosition = imageCoverPosition
    ? `center ${(1 - imageCoverPosition) * 100}%`
    : undefined

  const imageBlockUrl =
    getPageProperty<string>('Social Image', block) ||
    (block as PageBlock).format?.page_cover
  const imageFallbackUrl = libConfig.defaultPageCover ?? undefined

  const blockIcon = getBlockIcon(block)
  const authorImageBlockUrl =
    blockIcon && isUrl(blockIcon) ? blockIcon : undefined
  const authorImageFallbackUrl = libConfig.defaultPageIcon ?? undefined
  const [authorImage, image] = await Promise.all([
    getCompatibleImageUrl(authorImageBlockUrl, authorImageFallbackUrl),
    getCompatibleImageUrl(imageBlockUrl, imageFallbackUrl)
  ])

  const author = getPageProperty<string>('Author', block) || libConfig.author

  // const socialDescription =
  //   getPageProperty<string>('Description', block, recordMap) ||
  //   libConfig.description

  // const lastUpdatedTime = getPageProperty<number>(
  //   'Last Updated',
  //   block,
  //   recordMap
  // )
  const publishedTime = getPageProperty<number>('Published', block)
  const datePublished = publishedTime ? new Date(publishedTime) : undefined
  // const dateUpdated = lastUpdatedTime
  //   ? new Date(lastUpdatedTime)
  //   : publishedTime
  //   ? new Date(publishedTime)
  //   : undefined
  const date =
    isBlogPost && datePublished
      ? `${datePublished.toLocaleString('en-US', {
          month: 'long'
        })} ${datePublished.getFullYear()}`
      : undefined
  const detail = date || author || libConfig.domain

  const pageInfo: NotionPageInfo = {
    pageId,
    title,
    image,
    imageObjectPosition,
    author,
    authorImage,
    detail
  }

  return {
    type: 'success',
    data: pageInfo
  }
}

async function isUrlReachable(
  url: string | undefined | null
): Promise<boolean> {
  if (!url) {
    return false
  }

  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

function parsePageId(pageId?: string | null): string | null {
  if (!pageId) {
    return null
  }

  const cleaned = pageId.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length !== 32) {
    return null
  }

  return cleaned.replace(
    /^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,
    '$1-$2-$3-$4-$5'
  )
}

function getBlockValue(block: any) {
  return block?.value ?? block
}

function getBlockTitle(block: any): string | undefined {
  const value = getBlockValue(block)
  return value?.properties?.title?.[0]?.[0] ?? value?.properties?.Name?.[0]?.[0]
}

function getPageProperty<T>(propertyName: string, block: any): T | undefined {
  const value = getBlockValue(block)
  const property = value?.properties?.[propertyName]
  return Array.isArray(property) ? (property[0]?.[0] as T) : undefined
}

function getBlockIcon(block: any): string | undefined {
  const value = getBlockValue(block)
  return value?.format?.page_icon ?? value?.properties?.icon?.[0]?.[0]
}

function isUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(https?:)?\/\//.test(value)
  )
}

async function getCompatibleImageUrl(
  url: string | undefined | null,
  fallbackUrl: string | undefined | null
): Promise<string | undefined> {
  const image = (await isUrlReachable(url)) ? url : fallbackUrl

  if (image) {
    const imageUrl = new URL(image)

    if (imageUrl.host === 'images.unsplash.com') {
      if (!imageUrl.searchParams.has('w')) {
        imageUrl.searchParams.set('w', '1200')
        imageUrl.searchParams.set('fit', 'max')
        return imageUrl.toString()
      }
    }
  }

  return image ?? undefined
}
