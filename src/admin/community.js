// Admin > Community preview (Gary and Julie only; check-in helpers never reach Admin pages beyond check-in).
// Shows a clearly marked sample thank-you card on each of the nine approved backgrounds, with the official badge's
// gold shimmer and the soft text shadow switched on or off, so the designs can be checked on a phone.
// Nothing here is public, and nothing is saved: the switches are simply part of the page address.
import { textResponse } from '../lib/http.js';
import { html } from '../lib/html.js';
import { adminPage } from '../views/admin.js';
import { BACKGROUNDS, renderCard, sampleLayout, COMMUNITY_CSS } from '../community/card.js';
import { getRotation, suggestBackground } from '../community/model.js';

export async function handleCommunityAdmin({ env, url, method, path, page, csrf, admin }) {
  if (path !== '/admin/community' && !path.startsWith('/admin/community/')) return null;
  if (admin.role !== 'owner' && admin.role !== 'admin') return textResponse('Not allowed.', { status: 403 });
  if (path === '/admin/community') return new Response(null, { status: 302, headers: { Location: '/admin/community/preview', 'Cache-Control': 'no-store' } });
  if (path !== '/admin/community/preview') return null;
  if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });

  const shimmer = url.searchParams.get('shimmer') !== '0';
  const shadow = url.searchParams.get('shadow') !== '0';
  let next = '';
  try { next = suggestBackground(await getRotation(env)); } catch { next = ''; }
  return page(previewPage({ shimmer, shadow, next, csrf: csrf.token }));
}

function previewPage({ shimmer, shadow, next, csrf }) {
  const link = (s, sh) => `/admin/community/preview?shimmer=${s ? 1 : 0}&shadow=${sh ? 1 : 0}`;
  const body = html`<link rel="stylesheet" href="${COMMUNITY_CSS}">
<div class="nwc-admin-intro">
<p><strong>Not public yet.</strong> This preview is only visible in Admin. The Community is not in the website’s menu, and no thank-you card can be published until the card editor is added.</p>
<p>Each card below uses <strong>sample wording</strong> and the official New Way’s badge as a separate layer. The background rotation uses all nine designs before any repeats${next ? html`; the next card would start with <strong>Design ${next}</strong>` : ''}.</p>
<p>If your phone is set to reduce or remove animations, the badge is shown still, exactly as visitors with that setting will see it.</p>
</div>
<div class="nwc-toggles" role="group" aria-label="Preview options">
<a class="nwc-toggle" href="${link(!shimmer, shadow)}" aria-pressed="${shimmer ? 'true' : 'false'}">Animate Logo: ${shimmer ? 'On' : 'Off'}</a>
<a class="nwc-toggle" href="${link(shimmer, !shadow)}" aria-pressed="${shadow ? 'true' : 'false'}">Text shadow: ${shadow ? 'On' : 'Off'}</a>
</div>
<div class="nwc-preview-list">
${BACKGROUNDS.map((bg, i) => html`<section class="nwc-preview-item" aria-label="Design ${bg}">
<h2>Design ${bg}</h2>
${renderCard(sampleLayout(bg, { shimmer, shadow }), { priority: i === 0, uid: 'a' + bg, alt: `Sample thank-you card on design ${bg}` })}
</section>`)}
</div>`;
  return adminPage({ title: 'Community preview', body, csrf, signedIn: true });
}
