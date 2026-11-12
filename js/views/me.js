/* views/me.js — settings, AI configuration, backup, about. */

import { h } from '../core/dom.js';
import { button, card, chips, tag, kv, toast, confirmSheet, showSheet } from '../ui/components.js';
import * as ai from '../features/ai.js';
import * as openai from '../features/providers/openai.js';
import * as claude from '../features/providers/claude.js';
import { estimateKnown } from '../domain/engine.js';
import { coverageOf } from '../domain/coverage.js';
import { buildCard, dataUrlToBlob, isInAppBrowser, prefersSystemShare, shareFile, saveBlob, shareApp } from '../features/share.js';
import { parseImport } from '../domain/importer.js';
import { daysUntil } from '../core/format.js';

const LEVELS = [
  { id: 'cet4', label: '四级' },
  { id: 'cet6', label: '六级' },
  { id: 'both', label: '四六级都要' },
];

export function render(ctx) {
  const state = ctx.state;
  const root = h('div', { class: 'v-me stack stack--lg' });

  function paint() {
    root.replaceChildren(headerLite(), profileCard(), statsCard(), shareCardView(), aiCard(), importCard(), backupCard(), aboutCard());
  }

  function shareStats() {
    const known = estimateKnown(ctx.data.words, state.theta, state.profile.level);
    const corpus = ctx.data.readingStats?.corpus;
    return {
      known: known.known,
      total: known.total,
      coverage: corpus ? coverageOf(corpus, ctx.data.byWord, state.theta, state).ratio : 0,
      streak: state.stats.streak || 0,
      days: Object.keys(state.stats.days || {}).length,
      reviewing: Object.values(state.words).filter((w) => (w.reps || 0) > 0).length,
      examIn: daysUntil(state.profile.examDate),
      level: state.profile.level,
      theta: state.theta,
    };
  }

  function shareCardView() {
    const stats = shareStats();
    let dataUrl = '';
    let file = null;
    try {
      const canvas = buildCard(stats);
      dataUrl = canvas.toDataURL('image/png');
      file = new File([dataUrlToBlob(dataUrl)], 'cet-card.png', { type: 'image/png' });
    } catch (error) {
      console.warn('share card failed', error);
    }

    const inAppHint = () => showSheet({
      title: '在浏览器中打开',
      body: h('p', { class: 'small muted' }, '微信 / QQ 内置浏览器不支持直接分享。点右上角「···」，选「在浏览器中打开」后再分享。'),
      actions: [{ label: '知道了' }],
    });

    const systemShare = prefersSystemShare();
    return card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '分享'),
        file
          ? h('div', { class: 'center' }, h('img', { class: 'v-me__preview', alt: '学习画像', src: dataUrl }))
          : h('div', { class: 'c-panel small' }, '卡片生成失败'),
        h('div', { class: 'row row--wrap' },
          systemShare ? button({
            label: '分享卡片', variant: 'primary', size: 'sm',
            onClick: () => {
              if (!file) return;
              if (isInAppBrowser()) { inAppHint(); return; }
              shareFile(file).then((result) => {
                if (result === 'downloaded') toast('图片已保存，可手动分享', 'ok');
              }).catch((error) => {
                if (error?.name !== 'AbortError') toast('分享失败', 'error');
              });
            },
          }) : button({
            label: '下载卡片', variant: 'primary', size: 'sm',
            onClick: () => {
              if (!file) return;
              saveBlob(file);
              toast('图片已保存', 'ok');
            },
          }),
          systemShare ? button({
            label: '保存图片', size: 'sm',
            onClick: () => {
              if (!file) return;
              saveBlob(file);
              toast('已保存', 'ok');
            },
          }) : null,
        ),
        button({
          label: '分享这个工具', variant: 'ghost', block: true, size: 'sm',
          onClick: async () => {
            const result = await shareApp();
            if (result === 'inapp') inAppHint();
            else if (result === 'copied') toast('链接已复制', 'ok');
          },
        }),
      ),
    });
  }

  function headerLite() {
    return h('header', { class: 'page-head' },
      h('div', null,
        h('h1', { class: 'page-title' }, '我的'),
        h('div', { class: 'page-sub' }, '设置、AI 与备份'),
      ),
    );
  }

  function profileCard() {
    const days = daysUntil(state.profile.examDate);
    return card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '学习档案'),
        h('div', { class: 'c-label' }, '目标'),
        chips(LEVELS, state.profile.level, (id) => { ctx.actions.setProfile({ level: id }); paint(); }),
        h('div', { class: 'c-label', style: { 'margin-top': '10px' } }, '考试日期'),
        h('input', {
          class: 'c-input', type: 'date', value: state.profile.examDate,
          onchange: (e) => { ctx.actions.setProfile({ examDate: e.target.value }); paint(); },
        }),
        days != null ? h('div', { class: 'xs muted', style: { 'margin-top': '4px' } }, `还有 ${days} 天`) : null,
        h('div', { class: 'c-label', style: { 'margin-top': '10px' } }, '每天新词'),
        h('div', { class: 'c-pill-row' }, [10, 20, 30, 50].map((n) => h('button', {
          type: 'button',
          class: ['c-chip', state.profile.dailyNew === n && 'is-active'].filter(Boolean).join(' '),
          onclick: () => { ctx.actions.setProfile({ dailyNew: n }); paint(); },
        }, `${n}`))),
        h('div', { class: 'row', style: { 'margin-top': '12px' } },
          button({ label: '重新校准', size: 'sm', onClick: () => ctx.go('#/onboarding') }),
          button({ label: '词库', size: 'sm', onClick: () => ctx.go('#/words') }),
        ),
      ),
    });
  }

  function statsCard() {
    const known = estimateKnown(ctx.data.words, state.theta, state.profile.level);
    const mastered = Object.values(state.words).filter((w) => w.k).length;
    const touched = Object.values(state.words).filter((w) => (w.seen || 0) > 0).length;
    const dayCount = Object.keys(state.stats.days || {}).length;
    return card({
      variant: 'yellow',
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '学习统计'),
        kv('预计已掌握', `${known.known} / ${known.total}`),
        kv('手动标记已会', String(mastered)),
        kv('接触过的词', String(touched)),
        kv('学习天数', String(dayCount)),
        kv('连续天数', String(state.stats.streak || 0)),
        kv('能力值 θ', state.theta.toFixed(2)),
        state.calib.at ? h('div', { class: 'xs faint' }, `上次校准：${new Date(state.calib.at).toLocaleString('zh-CN')}`) : null,
      ),
    });
  }

  function aiCard() {
    const a = state.ai;
    const presets = Object.entries(ai.PRESETS).map(([id, p]) => ({ id, label: p.label }));
    return card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'row row--between' },
          h('div', { class: 'bold' }, 'AI 设置'),
          h('span', { class: 'xs muted' }, ai.isConfigured(a) ? '已配置' : '未配置'),
        ),
        h('p', { class: 'xs muted' }, 'Key 只保存在本机。'),
        chips(presets, a.provider, (id) => {
          const preset = ai.PRESETS[id];
          ctx.actions.setAI({
            provider: id,
            baseUrl: preset.baseUrl || a.baseUrl,
            model: preset.model || a.model,
          });
          paint();
        }),
        h('div', { class: 'c-field' },
          h('label', { class: 'c-label' }, '接口地址'),
          h('input', { class: 'c-input', value: a.baseUrl, placeholder: 'https://api.deepseek.com/v1', onchange: (e) => ctx.actions.setAI({ baseUrl: e.target.value.trim() }) }),
        ),
        h('div', { class: 'c-field' },
          h('label', { class: 'c-label' }, 'API Key'),
          h('input', { class: 'c-input', type: 'password', value: a.apiKey, autocomplete: 'off', placeholder: 'sk-…', onchange: (e) => ctx.actions.setAI({ apiKey: e.target.value.trim() }) }),
        ),
        h('div', { class: 'c-field' },
          h('label', { class: 'c-label' }, '模型名'),
          h('input', { class: 'c-input', value: a.model, placeholder: 'deepseek-chat', onchange: (e) => ctx.actions.setAI({ model: e.target.value.trim() }) }),
        ),
        h('div', { class: 'c-field' },
          h('label', { class: 'c-label' }, '会话预算（0 = 不限）'),
          h('input', {
            class: 'c-input', type: 'number', min: 0, value: a.budget,
            onchange: (e) => { ctx.actions.setAI({ budget: Number(e.target.value) || 0 }); paint(); },
          }),
        ),
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '本次会话已用'), h('span', { class: 'bold' }, `${a.sessionTokens || 0} tokens`)),
        h('div', { class: 'row', style: { 'margin-top': '8px' } },
          button({ label: '测试连接', size: 'sm', onClick: testAI }),
          button({ label: '清零用量', size: 'sm', onClick: () => { ctx.actions.setAI({ sessionTokens: 0 }); paint(); } }),
        ),
      ),
    });
  }

  async function testAI() {
    const a = state.ai;
    if (!ai.isConfigured(a)) { toast('先把地址、Key、模型填完'); return; }
    const ok = await confirmSheet('测试连接', '会发送一条很短（约 8 token）的测试请求。', { okLabel: '发送测试' });
    if (!ok) return;
    try {
      const provider = ai.presetOf(a.provider).kind === 'claude' ? claude : openai;
      await provider.ping({ baseUrl: a.baseUrl, apiKey: a.apiKey, model: a.model });
      toast('连接成功', 'ok');
    } catch (error) {
      ctx.toast(ai.friendlyAIError(error), 'error');
    }
  }

  function importCard() {
    let text = '';
    const ta = h('textarea', {
      class: 'c-textarea', style: { 'min-height': '90px' },
      placeholder: '粘贴 JSON，例如 {"items": [{"type":"w2m","prompt":"abide","options":["忍受","放弃","加速","测量"],"answer":0,"explain":"abide=忍受"}]}',
      oninput: (e) => { text = e.target.value; },
    });
    return card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '导入题库'),
        h('p', { class: 'xs muted' },
          '支持词汇题与阅读 / 选词 / 匹配 / 翻译 / 写作 JSON，只存本机。'),
        ta,
        h('div', { class: 'row' },
          button({
            label: '导入', size: 'sm', variant: 'primary',
            onClick: async () => {
              const { items, errors } = parseImport(text);
              if (!items.length) {
                toast(errors[0] || '没有可导入的题目', 'error');
                return;
              }
              const total = ctx.actions.importQuestions(items);
              toast(`导入 ${items.length} 题，共 ${total} 题`, 'ok');
              if (errors.length) {
                await showSheet({
                  title: '部分题目被跳过',
                  body: h('ul', { class: 'stack small' }, errors.slice(0, 8).map((e) => h('li', null, e))),
                  actions: [{ label: '知道了' }],
                });
              }
              paint();
            },
          }),
          button({
            label: '清空导入', size: 'sm',
            onClick: async () => {
              if (!state.custom.length) { toast('还没有导入的题目'); return; }
              const ok = await confirmSheet('清空导入', `会删除已导入的 ${state.custom.length} 道题，内置题库不受影响。`, { okLabel: '清空', tone: 'red' });
              if (!ok) return;
              ctx.actions.clearImported();
              toast('已清空');
              paint();
            },
          }),
        ),
        h('div', { class: 'xs faint' }, `当前已导入 ${state.custom.length} 题`),
      ),
    });
  }

  function backupCard() {
    return card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '数据备份'),
        h('p', { class: 'xs muted' }, '记录只在本机，换设备前先导出。'),
        h('div', { class: 'row' },
          button({ label: '导出 JSON', size: 'sm', onClick: exportData }),
          button({ label: '导入 JSON', size: 'sm', onClick: () => fileInput.click() }),
        ),
        h('div', { style: { 'margin-top': '10px' } },
          button({ label: '清空全部数据', variant: 'red', size: 'sm', onClick: resetAll }),
        ),
      ),
    });
  }

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== 'object' || !data.profile || !data.words) throw new Error('格式不对');
        const ok = await confirmSheet('导入备份', '会覆盖当前学习记录，确定吗？', { okLabel: '覆盖导入', tone: 'red' });
        if (!ok) return;
        ctx.store.replace(data);
        toast('已导入', 'ok');
        ctx.go('#/today');
      } catch (error) {
        toast(`导入失败：${error.message}`, 'error');
      }
    },
  });

  function exportData() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `cet-collage-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出', 'ok');
  }

  async function resetAll() {
    const ok = await confirmSheet('清空全部数据', '学习记录、设置、AI Key 都会被删除，且不可恢复。', { okLabel: '确认清空', tone: 'red' });
    if (!ok) return;
    ctx.store.reset();
    toast('已清空');
    ctx.go('#/onboarding');
  }

  async function forceRefresh() {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch { /* ignore */ }
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch { /* ignore */ }
    location.reload();
  }

  function aboutCard() {
    return card({
      variant: 'blue',
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '关于'),
        h('div', { class: 'xs muted' },
          '词库数据来自 KyleBing/english-vocabulary（BSD-3-Clause），难度由 hermitdave/FrequencyWords（MIT）词频估算。',
          h('br'),
          '阅读覆盖率按站内阅读语料的词频加权估算。',
          h('br'),
          '题目为原创、程序生成，或来自公开整理仓库（cypher-yht、Drhm1224、123xzw999）；部分真题文本仅供非商用学习。',
          h('br'),
          '文学角使用 Project Gutenberg / Wikisource 的公版文本（作者去世 50 年以上）。',
          h('br'),
          '听力模块未内置（原音频需配套真题文本，版权受限）。',
        ),
        h('div', { class: 'row', style: { 'margin-top': '8px' } },
          button({ label: '刷新到最新版本', size: 'sm', onClick: forceRefresh }),
        ),
        h('div', { class: 'xs faint' }, '看不到新题时点一下。'),
        h('div', { class: 'xs faint', style: { 'margin-top': '6px' } }, 'supersuper四六级 · v1'),
      ),
    });
  }

  paint();
  return root;
}
