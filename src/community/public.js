// New Way's Community: the public page for one published thank-you card, at its own address
// (/community/12-thank-you-jane-smith), with its own Facebook preview details.
//
// While the Community is being built it stays hidden: it is not in the menu or the sitemap, its pages ask Google not
// to list them, and only cards Gary or Julie have published (Admin › Community cards) are shown; anything else is
// "not found". A published card's address is the link they share on Facebook.
import { htmlResponse, redirect, siteOrigin } from '../lib/http.js';
import { html } from '../lib/html.js';
import { page } from '../views/layout.js';
import * as pub from '../views/public.js';
import { longDate, isIsoDate } from '../lib/dates.js';
import { renderCard, parseLayout, cardWording, COMMUNITY_CSS, CARD_FONTS_CSS, BACKGROUNDS } from './card.js';
import { getPublishedPost, postPath } from './model.js';

// Kept out of Google until Gary and Julie launch the Community. Facebook can still read the preview details.
export const COMMUNITY_HIDDEN = true;

export async function handleCommunityRoutes(request, env, url, method, path) {
  const m = path.match(/^\/community\/(\d{1,9})(?:-([a-z0-9-]{0,90}))?$/);
  if (!m || method !== 'GET') return null;
  const post = await getPublishedPost(env, Number(m[1]));
  const ctx = await pub.pageContext(request, env);
  if (!post) return htmlResponse(await pub.notFoundPage(ctx), { status: 404, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
  const canonicalPath = postPath(post);
  if (path !== canonicalPath) return redirect(canonicalPath + url.search, 301);
  return htmlResponse(postPage(ctx, post, request, env), { headers: COMMUNITY_HIDDEN ? { 'X-Robots-Tag': 'noindex, nofollow' } : {} });
}

export function postPage(ctx, post, request, env) {
  const origin = siteOrigin(request, env);
  const layout = parseLayout(post.layout_json);
  layout.shimmer = post.animate_logo === 1;
  layout.shadow = post.text_shadow === 1;
  if (BACKGROUNDS.includes(post.background)) layout.background = post.background;   // the card's chosen design
  const title = post.title || (post.medium_name ? `Thank you, ${post.medium_name}` : 'Thank you');
  const wording = cardWording(layout);
  const when = isIsoDate(post.wed_date) ? longDate(post.wed_date) : '';
  const description = (wording || title).slice(0, 200);
  const body = html`<link rel="stylesheet" href="${COMMUNITY_CSS}"><link rel="stylesheet" href="${CARD_FONTS_CSS}" crossorigin>
<article class="nwc-post">
${renderCard(layout, { priority: true, uid: 'p' + post.id })}
${when ? html`<p class="nwc-meta">${when}</p>` : ''}
</article>`;
  return page(ctx, {
    route: 'community', title, description, body, canonicalPath: postPath(post), noindex: COMMUNITY_HIDDEN,
    og: post.share_key
      ? { title, description, image: `${origin}/media/${post.share_key}`, imageWidth: 1200, imageHeight: 630, imageType: 'image/jpeg', imageAlt: wording || title }
      : { title, description }
  });
}
