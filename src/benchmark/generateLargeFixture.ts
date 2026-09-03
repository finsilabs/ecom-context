/**
 * Writes benchmark/fixture-large/store/ (v1 layout) — a year of rules, months of
 * decisions, many channels. The data is authored in the pre-v1 shape it was
 * first measured in and converted through the same `migrateContext` the CLI
 * uses, so the fixture is exactly what `ecom-context migrate` would produce.
 * Run: npx tsx src/benchmark/generateLargeFixture.ts
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateContext, writeV1 } from '../migrate.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../benchmark/fixture-large/store');
mkdirSync(dir, { recursive: true });

function iso(d: string): string {
  return `${d}T00:00:00.000Z`;
}

const channels = [
  { id: 'email', name: 'Klaviyo', kind: 'email', status: 'active', window: '30d', revenue: 18420, spend: null, orders: 410,
    approaches: [
      { id: 'ap_email_freq', tried_at: iso('2026-02-10'), kind: 'frequency', outcome: 'worked' },
      { id: 'ap_email_subj', tried_at: iso('2025-11-02'), kind: 'creative', outcome: 'worked' },
    ] },
  { id: 'sms', name: 'SMS', kind: 'sms', status: 'paused', window: '30d', revenue: 900, spend: 400, orders: 22,
    approaches: [{ id: 'ap_sms_late', tried_at: iso('2025-12-01'), kind: 'timing', outcome: 'did_not_work' }] },
  { id: 'meta', name: 'Meta prospecting', kind: 'paid_social', status: 'paused', window: '30d', revenue: 6200, spend: 8900, orders: 55,
    approaches: [
      { id: 'ap_meta_cr', tried_at: iso('2026-03-01'), kind: 'creative', outcome: 'did_not_work' },
      { id: 'ap_meta_aud', tried_at: iso('2026-06-01'), kind: 'audience', outcome: 'did_not_work' },
    ] },
  { id: 'google', name: 'Google Search', kind: 'search', status: 'active', window: '30d', revenue: 7400, spend: 3100, orders: 90,
    approaches: [{ id: 'ap_g_brand', tried_at: iso('2025-09-15'), kind: 'audience', outcome: 'worked' }] },
  { id: 'tiktok', name: 'TikTok Spark', kind: 'paid_social', status: 'paused', window: '30d', revenue: 1100, spend: 2400, orders: 18,
    approaches: [{ id: 'ap_tt_ugc', tried_at: iso('2026-01-20'), kind: 'creative', outcome: 'did_not_work' }] },
  { id: 'affiliate', name: 'Affiliate', kind: 'affiliate', status: 'retired', window: '30d', revenue: 0, spend: 0, orders: 0,
    approaches: [{ id: 'ap_aff_flat', tried_at: iso('2025-08-01'), kind: 'offer', outcome: 'did_not_work' }] },
  { id: 'organic', name: 'Organic social', kind: 'organic', status: 'active', window: '30d', revenue: null, spend: null, orders: null,
    approaches: [{ id: 'ap_org_reel', tried_at: iso('2026-04-04'), kind: 'creative', outcome: 'inconclusive' }] },
  { id: 'wholesale', name: 'Wholesale', kind: 'other', status: 'active', window: '30d', revenue: 5200, spend: null, orders: 14,
    approaches: [{ id: 'ap_ws_moq', tried_at: iso('2025-10-10'), kind: 'offer', outcome: 'worked' }] },
  { id: 'push', name: 'Push', kind: 'other', status: 'paused', window: '30d', revenue: 300, spend: null, orders: 8,
    approaches: [{ id: 'ap_push_d', tried_at: iso('2026-02-02'), kind: 'timing', outcome: 'did_not_work' }] },
  { id: 'retail', name: 'Retail pop-up', kind: 'other', status: 'retired', window: '30d', revenue: 0, spend: 0, orders: 0,
    approaches: [{ id: 'ap_ret', tried_at: iso('2025-07-07'), kind: 'other', outcome: 'did_not_work' }] },
];

const rules = [
  { id: 'gov_no_medical', effect: 'forbid', domain: 'copy', action: 'claim', object: 'medical_outcome', created_at: iso('2025-06-12') },
  { id: 'gov_discount_cap', effect: 'forbid', domain: 'offers', action: 'discount', object: 'deeper_than_20_pct', value: 20, created_at: iso('2025-07-03') },
  { id: 'gov_no_competitor', effect: 'forbid', domain: 'copy', action: 'mention_competitor', object: 'named_brand', created_at: iso('2025-08-01') },
  { id: 'gov_no_kids', effect: 'forbid', domain: 'audience', action: 'target_audience', object: 'children', created_at: iso('2025-08-20') },
  { id: 'gov_no_ugc', effect: 'forbid', domain: 'copy', action: 'use_ugc', object: 'without_release', created_at: iso('2025-09-09') },
  { id: 'gov_no_compare', effect: 'forbid', domain: 'offers', action: 'compare_at', object: 'inflated_compare_at', created_at: iso('2025-10-02') },
  { id: 'gov_no_sms_late', effect: 'forbid', domain: 'channel', action: 'send', object: 'sms_after_21h', created_at: iso('2025-11-11') },
  { id: 'gov_no_guarantee', effect: 'forbid', domain: 'legal', action: 'guarantee', object: 'unlimited_money_back', created_at: iso('2025-12-01') },
  { id: 'gov_no_health_badge', effect: 'forbid', domain: 'copy', action: 'claim', object: 'fda_approved', created_at: iso('2026-01-08') },
  { id: 'gov_no_stack_discount', effect: 'forbid', domain: 'offers', action: 'discount', object: 'stack_with_subscribe', created_at: iso('2026-02-14') },
  { id: 'gov_no_tiktok_sound', effect: 'forbid', domain: 'channel', action: 'use_ugc', object: 'unlicensed_audio', created_at: iso('2026-03-02') },
  { id: 'gov_no_wholesale_map', effect: 'forbid', domain: 'offers', action: 'discount', object: 'below_map', created_at: iso('2026-04-18') },
  { id: 'gov_require_unsub', effect: 'require', domain: 'legal', action: 'send', object: 'unsubscribe_in_footer', created_at: iso('2025-06-12') },
  { id: 'gov_require_addr', effect: 'require', domain: 'legal', action: 'send', object: 'physical_address', created_at: iso('2025-06-12') },
  { id: 'gov_require_ingredient', effect: 'require', domain: 'copy', action: 'claim', object: 'ingredient_list_on_pdp', created_at: iso('2025-09-01') },
  { id: 'gov_require_utm', effect: 'require', domain: 'ops', action: 'send', object: 'utm_on_paid_urls', created_at: iso('2025-10-20') },
  { id: 'gov_require_holdout', effect: 'require', domain: 'channel', action: 'send', object: 'email_holdout_10pct', created_at: iso('2026-01-15') },
  { id: 'gov_require_consent', effect: 'require', domain: 'audience', action: 'send', object: 'sms_explicit_consent', created_at: iso('2026-02-01') },
  { id: 'gov_require_alt_text', effect: 'require', domain: 'copy', action: 'send', object: 'image_alt_text', created_at: iso('2026-05-05') },
  { id: 'gov_require_map_note', effect: 'require', domain: 'offers', action: 'discount', object: 'map_exception_logged', created_at: iso('2026-06-06') },
];

const history = [
  { id: 'dec_start_email', decided_at: iso('2025-06-01'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'email', outcome: 'positive', metric: 'revenue', before: 0, after: 4200 },
  { id: 'dec_start_meta', decided_at: iso('2025-06-15'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'meta', outcome: 'positive', metric: 'cac', before: 0, after: 38 },
  { id: 'dec_start_google', decided_at: iso('2025-07-01'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'google', outcome: 'positive', metric: 'roas', before: 0, after: 2.4 },
  { id: 'dec_start_aff', decided_at: iso('2025-07-20'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'affiliate', outcome: 'inconclusive' },
  { id: 'dec_start_sms', decided_at: iso('2025-08-01'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'sms', outcome: 'positive', metric: 'orders', before: 0, after: 40 },
  { id: 'dec_aff_stop', decided_at: iso('2025-08-28'), actor: 'operator', action: 'stop', target_type: 'channel', target_id: 'affiliate', outcome: 'negative', metric: 'revenue', before: 800, after: 0 },
  { id: 'dec_retail_start', decided_at: iso('2025-09-01'), actor: 'founder', action: 'start', target_type: 'channel', target_id: 'retail', outcome: 'inconclusive' },
  { id: 'dec_email_freq', decided_at: iso('2025-09-18'), actor: 'operator', action: 'test', target_type: 'channel', target_id: 'email', outcome: 'positive', metric: 'revenue', before: 9000, after: 11200 },
  { id: 'dec_ws_start', decided_at: iso('2025-10-10'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'wholesale', outcome: 'positive', metric: 'revenue', before: 0, after: 3000 },
  { id: 'dec_google_keep', decided_at: iso('2025-10-22'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'google', outcome: 'positive', metric: 'roas', before: 2.4, after: 2.6 },
  { id: 'dec_retail_stop', decided_at: iso('2025-11-02'), actor: 'founder', action: 'stop', target_type: 'channel', target_id: 'retail', outcome: 'negative', metric: 'revenue', before: 400, after: 0 },
  { id: 'dec_sms_late', decided_at: iso('2025-11-11'), actor: 'operator', action: 'change', target_type: 'channel', target_id: 'sms', outcome: 'negative', metric: 'unsub', before: 0.4, after: 1.8 },
  { id: 'dec_tt_start', decided_at: iso('2025-12-01'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'tiktok', outcome: 'inconclusive' },
  { id: 'dec_push_start', decided_at: iso('2026-01-05'), actor: 'operator', action: 'start', target_type: 'channel', target_id: 'push', outcome: 'inconclusive' },
  { id: 'dec_tt_stop', decided_at: iso('2026-01-22'), actor: 'operator', action: 'stop', target_type: 'channel', target_id: 'tiktok', outcome: 'negative', metric: 'cac', before: 55, after: 91 },
  { id: 'dec_sms_pause', decided_at: iso('2026-02-08'), actor: 'operator', action: 'stop', target_type: 'channel', target_id: 'sms', outcome: 'negative', metric: 'complaints', before: 2, after: 11 },
  { id: 'dec_email_keep_feb', decided_at: iso('2026-02-20'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'email', outcome: 'positive', metric: 'revenue', before: 15100, after: 16800 },
  { id: 'dec_push_pause', decided_at: iso('2026-02-28'), actor: 'operator', action: 'stop', target_type: 'channel', target_id: 'push', outcome: 'negative' },
  { id: 'dec_stop_meta', decided_at: iso('2026-03-08'), actor: 'operator', action: 'stop', target_type: 'channel', target_id: 'meta', outcome: 'negative', metric: 'cac', before: 40, after: 72 },
  { id: 'dec_keep_email_mar', decided_at: iso('2026-03-08'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'email', outcome: 'positive', metric: 'revenue', before: 15100, after: 18420 },
  { id: 'dec_google_keep_apr', decided_at: iso('2026-04-12'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'google', outcome: 'positive', metric: 'roas', before: 2.6, after: 2.5 },
  { id: 'dec_organic_test', decided_at: iso('2026-04-04'), actor: 'operator', action: 'test', target_type: 'channel', target_id: 'organic', outcome: 'inconclusive' },
  { id: 'dec_ws_keep', decided_at: iso('2026-05-01'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'wholesale', outcome: 'positive', metric: 'revenue', before: 4000, after: 5200 },
  { id: 'dec_meta_test_jun', decided_at: iso('2026-06-15'), actor: 'operator', action: 'test', target_type: 'channel', target_id: 'meta', outcome: 'negative', metric: 'cac', before: 72, after: 68 },
  { id: 'dec_email_keep_jun', decided_at: iso('2026-06-20'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'email', outcome: 'positive', metric: 'revenue', before: 17000, after: 18420 },
  { id: 'dec_google_jul', decided_at: iso('2026-07-09'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'google', outcome: 'positive' },
  { id: 'dec_tt_stay_paused', decided_at: iso('2026-07-18'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'tiktok', outcome: 'inconclusive' },
  { id: 'dec_email_aug', decided_at: iso('2026-08-02'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'email', outcome: 'positive', metric: 'revenue', before: 18000, after: 18420 },
  { id: 'dec_meta_still_paused', decided_at: iso('2026-08-10'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'meta', outcome: 'negative' },
  { id: 'dec_sms_still_paused', decided_at: iso('2026-08-10'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'sms', outcome: 'inconclusive' },
  { id: 'dec_organic_aug', decided_at: iso('2026-08-21'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'organic', outcome: 'inconclusive' },
  { id: 'dec_ws_aug', decided_at: iso('2026-08-21'), actor: 'operator', action: 'keep', target_type: 'channel', target_id: 'wholesale', outcome: 'positive' },
];

const notes = [
  { id: 'mem_positioning', written_at: iso('2025-06-05'), topic: 'positioning', text: 'Marrow & Co sells freeze-dried organ treats. The customer already cooks for their dog. This is food, not a veterinary drug.' },
  { id: 'mem_customer', written_at: iso('2025-06-05'), topic: 'customer', text: 'Primary buyer is a home-cook pet owner, 28–44, who reads ingredient lists. They bounce on medical-sounding copy.' },
  { id: 'mem_season', written_at: iso('2025-11-01'), topic: 'seasonality', text: 'Q4 is gift boxes. Spring is ' + 'wellness' + ' language, not medical.' },
  { id: 'mem_wholesale', written_at: iso('2026-01-11'), topic: 'wholesale', text: 'Independent pet shops. MAP is $29. Do not break MAP in DTC emails.' },
  { id: 'mem_sms_ban', written_at: iso('2026-02-09'), topic: 'sms', text: 'SMS paused after complaint spike. Do not turn it back on without legal.' },
  { id: 'mem_meta_mar', written_at: iso('2026-03-09'), topic: 'meta', text: 'Jordan killed Meta prospecting 8 Mar 2026. CAC 40 to 72. Not a maybe.' },
  { id: 'mem_june_retest', written_at: iso('2026-06-16'), topic: 'meta', text: 'June Meta audience test still negative. CAC 72 to 68. Left paused.' },
  { id: 'mem_email_core', written_at: iso('2026-08-02'), topic: 'email', text: 'Email is the core channel. Frequency test in Feb 2026 is the one that worked.' },
];

const { ctx, warnings } = migrateContext({ channels, rules, decisions: history, notes });
for (const w of warnings) console.error(`warning: ${w}`);
writeV1(dir, ctx);
console.log(`wrote ${dir} targets=${ctx.targets.length} rules=${ctx.governance.length} decisions=${ctx.history.length} brand_bytes=${Buffer.byteLength(ctx.brand)}`);
