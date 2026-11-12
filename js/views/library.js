/* views/library.js — 图书馆：按你的词表推荐考试阅读，也可以读文学角的故事。
 * 阅读器就住在这个视图里：点任意单词弹出查词卡，底部可标记已读 / 下一篇。 */

import { h, delegate } from '../core/dom.js';
import { button, card, chips, showSheet, statePanel, sticker, tag, toast } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { passageFit, recommendPassages } from '../domain/coverage.js';

const LEVEL_LABEL = { cet4: '四级', cet6: '六级', both: '全部' };
const LEVELS = ['cet4', 'cet6', 'both'];
/** 单词切分：只认字母词，保留词内连字符与撇号。 */
const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

function levelLabel(level) {
  return LEVEL_LABEL[level] || LEVEL_LABEL.cet6;
}

function levelTag(level) {
  return tag(levelLabel(level), level === 'cet4' ? 'blue' : 'violet');
}

function levelOk(itemLevel, filter) {
  return filter === 'both' || itemLevel === filter;
}

/** 生词率 = 1 - 覆盖率。 */
function unknownPct(ratio) {
  return ratio == null ? '—' : `${((1 - ratio) * 100).toFixed(1)}%`;
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    toast('当前浏览器不支持朗读', 'error');
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  try {
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* 忽略朗读失败 */ }
}

/** 词条标签：六级的词显示六级，否则四级。 */
function wordLevelTag(entry) {
  const groups = entry?.g || [];
  return levelTag(groups.includes('cet6') ? 'cet6' : 'cet4');
}

export function render(ctx) {
  const root = h('div', { class: 'v-library stack stack--lg' });
  const profileLevel = ctx.state.profile.level;
  const ui = {
    tab: 'exam',
    level: LEVELS.includes(profileLevel) ? profileLevel : 'both',
    reader: null,
    /** 文学角是懒加载：idle | loading | error（数据自己住在 ctx.data.stories） */
    storyState: 'idle',
    storyError: null,
  };

  // 事件委托：整个视图只挂一次监听，单词 span 不进循环挂监听。
  delegate(root, 'click', '.v-library__w', (event, span) => openWord(span.dataset.w));
  delegate(root, 'keydown', '.v-library__w', (event, span) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openWord(span.dataset.w);
  });

  /* ---------------- data ---------------- */

  function readingStats() {
    return (ctx.data.readingStats?.passages || []).filter((p) => p.type === 'reading');
  }

  function loadStories() {
    ui.storyState = 'loading';
    ctx.ensureStories()
      .then(() => { ui.storyState = 'idle'; paint(); })
      .catch((error) => {
        ui.storyState = 'error';
        ui.storyError = error;
        paint();
        toast('文学角加载失败', 'error');
      });
  }

  /* ---------------- words ---------------- */

  function openWord(raw) {
    const key = String(raw || '').toLowerCase();
    if (!key) return;
    const entry = ctx.data.byWord?.get(key) || null;
    const fav = entry ? (ctx.state.fav || []).includes(entry.w) : false;

    let favBtn = null;
    if (entry) {
      favBtn = button({
        label: fav ? '取消收藏' : '收藏',
        variant: fav ? 'mint' : '',
        onClick: () => {
          ctx.actions.toggleFav(entry);
          const now = (ctx.state.fav || []).includes(entry.w);
          favBtn.classList.toggle('c-btn--mint', now);
          if (favBtn.lastChild) favBtn.lastChild.textContent = now ? '取消收藏' : '收藏';
          toast(now ? '已收藏' : '已取消收藏', 'ok');
        },
      });
    }

    const body = h('div', { class: 'stack v-library__lookup' },
      h('div', { class: 'v-library__lookupword' }, entry?.w || key),
      entry?.i ? h('div', { class: 'v-library__ipa' }, `/${entry.i}/`) : null,
      entry
        ? h('div', { class: 'stack v-library__glosses' },
            (entry.t || []).slice(0, 4).map(([pos, cn]) => h('div', { class: 'v-library__gloss' },
              h('span', { class: 'c-tag c-tag--yellow' }, pos),
              h('span', { class: 'v-library__glosscn' }, cn),
            )),
          )
        : h('div', { class: 'small muted' }, '词库里没有这个词，可能是人名、地名或变形。'),
      h('div', { class: 'row row--wrap' },
        entry?.d != null ? tag(`难度 ${Number(entry.d).toFixed(1)}`) : null,
        entry ? wordLevelTag(entry) : null,
      ),
      h('div', { class: 'row row--wrap' },
        button({ label: '朗读', variant: 'blue', onClick: () => speak(entry?.w || key) }),
        favBtn,
      ),
    );

    showSheet({ title: '查词', body, actions: [{ label: '关闭', value: null }] });
  }

  /* ---------------- reader ---------------- */

  function openReader(kind, list, index) {
    ui.reader = { kind, list, index };
    // base.css 里有 scroll-behavior: smooth，scrollTo 会被动画拖住；scrollTop 直接赋值是瞬时的
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch { /* 老浏览器不认 instant */ }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    paint();
  }

  function paragraphs(text) {
    const clean = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!clean) return [h('p', { class: 'v-library__p v-library__p--empty' }, '暂无正文。')];
    return clean.split(/\n\s*\n/).map((raw) => {
      const p = raw.replace(/\s*\n\s*/g, ' ').trim();
      return p ? h('p', { class: 'v-library__p' }, wordSpans(p)) : null;
    }).filter(Boolean);
  }

  function wordSpans(text) {
    const nodes = [];
    let last = 0;
    for (const match of text.matchAll(WORD_RE)) {
      if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)));
      const word = match[0];
      const lower = word.toLowerCase().replace(/’/g, "'");
      nodes.push(h('span', {
        class: 'v-library__w',
        role: 'button',
        tabindex: '0',
        dataset: { w: lower },
      }, word));
      last = match.index + word.length;
    }
    if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
    return nodes;
  }

  function readerView() {
    const { kind, list, index } = ui.reader;
    const row = list[index];
    if (!row) {
      ui.reader = null;
      return homeView();
    }
    const item = kind === 'story' ? row : row.item;
    const ratio = kind === 'story' ? null : row.ratio;
    const readSet = new Set(ctx.state.read || []);
    const isRead = readSet.has(item.id);
    const next = list[index + 1] || null;

    const meta = kind === 'story'
      ? [item.author, item.year].filter(Boolean).join(' · ')
      : [item.paperTitle, levelLabel(item.level)].filter(Boolean).join(' · ');

    const extraTags = kind === 'story'
      ? [
          item.words ? tag(`${item.words} 词`) : null,
          item.unknownRatio != null ? tag(`生词率 ${(item.unknownRatio * 100).toFixed(1)}%`) : null,
        ]
      : [tag(`生词率 ${unknownPct(ratio)}`)];

    return h('div', { class: 'v-library__reader stack stack--lg' },
      h('div', { class: 'row v-library__rtop' },
        button({
          label: '返回列表', variant: 'ghost', size: 'sm',
          onClick: () => { ui.reader = null; paint(); },
        }),
      ),
      h('header', { class: 'v-library__rhead stack' },
        h('div', { class: 'xs bold muted' }, meta),
        h('h1', { class: 'page-title v-library__rtitle' }, item.title || '无标题'),
        h('div', { class: 'row row--wrap' },
          levelTag(item.level),
          ...extraTags,
          isRead ? tag('已读', 'mint') : null,
        ),
      ),
      h('article', { class: 'v-library__text' }, paragraphs(kind === 'story' ? item.text : item.passage)),
      h('div', { class: 'v-library__rfoot' },
        h('div', { class: 'row row--wrap' },
          button({
            label: isRead ? '标记未读' : '标记已读',
            variant: isRead ? 'mint' : '',
            onClick: () => {
              if (isRead) {
                ctx.actions.unmarkRead(item.id);
                toast('已标记未读', 'ok');
              } else {
                ctx.actions.markRead(item.id);
                toast('已标记已读', 'ok');
              }
              paint();
            },
          }),
          next
            ? button({ label: '下一篇', onClick: () => openReader(kind, list, index + 1) })
            : null,
          kind === 'exam' && item.questions?.length
            ? button({
                label: '去做题',
                variant: 'primary',
                onClick: () => {
                  // exam.js 从 contentById 里按 id 取回这篇阅读
                  ctx.pending.reading = item.id;
                  ctx.go('#/exam');
                },
              })
            : null,
        ),
        h('div', { class: 'row row--wrap' },
          button({
            label: '返回列表', variant: 'ghost',
            onClick: () => { ui.reader = null; paint(); },
          }),
        ),
        h('div', { class: 'xs faint' }, '点任意单词即可查词、朗读或收藏。'),
      ),
    );
  }

  /* ---------------- exam reading ---------------- */

  function examView() {
    const state = ctx.state;
    const statsList = readingStats();
    const readSet = new Set(state.read || []);

    const picks = statsList.length
      ? recommendPassages(statsList, ctx.data.byWord, state.theta, state, { level: ui.level })
      : [];

    const statsById = new Map(statsList.map((p) => [p.id, p]));
    const rows = (ctx.data.content || [])
      .filter((item) => item.type === 'reading' && levelOk(item.level, ui.level))
      .map((item) => {
        const st = statsById.get(item.id);
        const fit = st ? passageFit(st, ctx.data.byWord, state.theta, state) : null;
        return { item, ratio: fit ? fit.ratio : null, unknownWords: fit ? fit.unknownWords : null };
      })
      // 越接近“全认识”越靠前：先读得动，再啃难的。
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));

    const pickSection = h('section', { class: 'v-library__sec stack' },
      h('div', { class: 'row row--between v-library__sechead' },
        h('h2', { class: 'v-library__h2' }, '为你推荐'),
        h('span', { class: 'xs muted' }, '只差几个词就能读懂'),
      ),
      picks.length
        ? h('div', { class: 'v-library__picks' },
            picks.map((pick, i) => {
              const item = ctx.data.contentById.get(pick.passage.id);
              if (!item) return null;
              return card({
                variant: i === 0 ? 'yellow' : '',
                className: 'v-library__pick',
                children: h('div', { class: 'stack v-library__pickbody' },
                  h('div', { class: 'row row--between' },
                    levelTag(item.level),
                    tag(`生词率 ${unknownPct(pick.ratio)}`, pick.ratio >= 0.92 ? 'mint' : 'yellow'),
                  ),
                  h('div', { class: 'bold v-library__picktitle' }, item.title || '未命名阅读'),
                  item.paperTitle
                    ? h('div', { class: 'xs faint truncate' }, item.paperTitle)
                    : null,
                  h('div', { class: 'xs muted' }, `还差 ${pick.unknownWords} 个词就全认识`),
                  button({
                    label: '开始阅读', variant: i === 0 ? 'primary' : '', block: true,
                    onClick: () => {
                      const at = rows.findIndex((r) => r.item.id === item.id);
                      openReader('exam', at >= 0 ? rows : [{ item, ratio: pick.ratio }], at >= 0 ? at : 0);
                    },
                  }),
                ),
              });
            }),
          )
        : statePanel('empty', { title: '这个级别还没有阅读材料', message: '换一个级别看看。' }),
    );

    const listSection = h('section', { class: 'v-library__sec stack' },
      h('div', { class: 'row row--between v-library__sechead' },
        h('h2', { class: 'v-library__h2' }, '全部阅读'),
        h('span', { class: 'xs muted' }, `共 ${rows.length} 篇 · 越好读越靠前`),
      ),
      rows.length
        ? h('div', { class: 'v-library__list' },
            rows.map((row, index) => h('div', { class: 'v-library__row', dataset: { id: row.item.id } },
              h('div', { class: 'grow stack v-library__rowmain' },
                h('div', { class: 'row row--wrap' },
                  h('div', { class: 'v-library__rowtitle' }, row.item.title || '未命名阅读'),
                  readSet.has(row.item.id) ? tag('已读', 'mint') : null,
                ),
                h('div', { class: 'row v-library__rowmeta' },
                  h('span', { class: 'xs muted truncate grow' },
                    [levelLabel(row.item.level), row.item.paperTitle].filter(Boolean).join(' · ')),
                  h('span', { class: 'xs muted nowrap' },
                    `生词率 ${unknownPct(row.ratio)}`
                    + (row.unknownWords != null ? ` · 还差 ${row.unknownWords} 词` : '')),
                ),
              ),
              button({ label: '开始阅读', onClick: () => openReader('exam', rows, index) }),
            )),
          )
        : statePanel('empty', { title: '这个级别还没有阅读材料', message: '换一个级别或全部看看。' }),
    );

    return h('div', { class: 'stack stack--lg' }, pickSection, listSection);
  }

  /* ---------------- literature ---------------- */

  function storyView() {
    if (!ctx.data.stories) {
      if (ui.storyState === 'idle') loadStories();
      if (ui.storyState === 'error') {
        return statePanel('error', {
          title: '文学角加载失败',
          message: ui.storyError?.message || '请检查网络后重试。',
          action: button({
            label: '重试', variant: 'primary',
            onClick: () => { ui.storyState = 'idle'; ui.storyError = null; paint(); },
          }),
        });
      }
      return statePanel('loading', { message: '正在加载文学角…' });
    }

    const readSet = new Set(ctx.state.read || []);
    const stories = (ctx.data.stories.items || []).filter((s) => levelOk(s.level, ui.level));

    if (!stories.length) {
      return statePanel('empty', {
        title: '这个级别还没有故事',
        message: '文学角正在补充，换一个级别看看。',
        action: button({ label: '看全部', onClick: () => { ui.level = 'both'; paint(); } }),
      });
    }

    return h('section', { class: 'v-library__sec stack' },
      h('div', { class: 'row row--between v-library__sechead' },
        h('h2', { class: 'v-library__h2' }, '文学角'),
        h('span', { class: 'xs muted' }, `共 ${stories.length} 篇 · 公版短文`),
      ),
      h('div', { class: 'v-library__stories' },
        stories.map((story, index) => card({
          className: 'v-library__story',
          children: h('div', { class: 'stack' },
            h('div', { class: 'row row--between' },
              h('div', { class: 'bold v-library__storytitle' }, story.title || '无标题'),
              levelTag(story.level),
            ),
            h('div', { class: 'xs muted' },
              [story.author, story.year].filter(Boolean).join(' · ')
              + (story.words ? ` · ${story.words} 词` : ''),
            ),
            story.summaryZh ? h('div', { class: 'small v-library__summary' }, story.summaryZh) : null,
            h('div', { class: 'row row--wrap' },
              readSet.has(story.id) ? tag('已读', 'mint') : null,
              story.unknownRatio != null ? tag(`生词率 ${(story.unknownRatio * 100).toFixed(1)}%`) : null,
            ),
            button({ label: '开始阅读', block: true, onClick: () => openReader('story', stories, index) }),
          ),
        })),
      ),
    );
  }

  /* ---------------- home ---------------- */

  function homeView() {
    const state = ctx.state;
    const readCount = (state.read || []).length;
    const examTotal = (ctx.data.content || []).filter((item) => item.type === 'reading').length;
    const storyTotal = ctx.data.stories?.items?.length || 0;
    const stats = `已读 ${readCount} 篇 · 阅读 ${examTotal} 篇${storyTotal ? ` · 故事 ${storyTotal} 篇` : ''}`;

    // 根节点已经带 .v-library，这里只排内容，避免同一标记嵌套两次
    return h('div', { class: 'stack stack--lg' },
      h('header', { class: 'v-library__head' },
        h('div', { class: 'v-library__illust' }, icon('library', 'c-icon--xl')),
        h('div', { class: 'grow stack v-library__headtext' },
          h('div', { class: 'xs bold muted' }, '咱今天就读起来~~'),
          h('h1', { class: 'page-title' }, '图书馆'),
          h('div', { class: 'small muted v-library__stats' }, stats),
        ),
        sticker(`${readCount} 篇`),
      ),
      h('div', { class: 'v-library__tabs' }, chips(
        [{ id: 'exam', label: '考试阅读' }, { id: 'story', label: '文学角' }],
        ui.tab,
        (id) => { ui.tab = id; ui.reader = null; paint(); },
      )),
      h('div', { class: 'v-library__levels' },
        h('span', { class: 'xs bold muted' }, '级别'),
        chips(
          [{ id: 'cet4', label: '四级' }, { id: 'cet6', label: '六级' }, { id: 'both', label: '全部' }],
          ui.level,
          (id) => { ui.level = id; ui.reader = null; paint(); },
        ),
      ),
      ui.tab === 'exam' ? examView() : storyView(),
    );
  }

  function paint() {
    root.replaceChildren(ui.reader ? readerView() : homeView());
  }

  if (!ctx.data.content?.length) {
    root.replaceChildren(statePanel('loading', { message: '正在加载阅读文库…' }));
    ctx.ensureExamData()
      .then(() => paint())
      .catch((error) => {
        root.replaceChildren(statePanel('error', {
          title: '阅读文库加载失败',
          message: error.message,
          action: button({ label: '重试', variant: 'primary', onClick: () => ctx.refresh() }),
        }));
      });
  } else {
    paint();
  }

  return root;
}
