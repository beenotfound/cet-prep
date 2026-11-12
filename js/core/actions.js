/* core/actions.js — the only place that mutates state slices. */

import * as E from '../domain/engine.js';

export function createActions({ store, data }) {
  const state = () => store.get();
  const byWord = data.byWord;

  function commit() {
    store.touch();
    store.sync();
  }

  return {
    setProfile(patch) {
      Object.assign(state().profile, patch);
      commit();
    },

    setUI(patch) {
      Object.assign(state().ui, patch);
      commit();
    },

    setTheta(theta) {
      state().theta = E.clamp(theta, -2, 12);
      commit();
    },

    finishCalibration(result) {
      const s = state();
      s.theta = E.clamp(result.theta, -2, 12);
      s.calib = { at: Date.now(), se: result.se, items: result.items, spot: result.spot || null };
      s.profile.onboarded = true;
      commit();
    },

    /** Onboarding calibration tap: 1 = 认识, 0.5 = 眼熟, 0 = 不认识. */
    calibrateAnswer(word, score) {
      const s = Number(score);
      const st = state();
      st.theta = E.recordAnswer({ state: st, theta: st.theta, k: 0.9 }, word, s);
      E.bumpDay(st, 'total');
      if (s >= 0.5) E.bumpDay(st, 'correct');
      commit();
    },

    markRead(id) {
      const s = state();
      const key = String(id || '');
      if (!key || s.read.includes(key)) return;
      s.read = [...s.read, key];
      commit();
    },

    unmarkRead(id) {
      const s = state();
      const key = String(id || '');
      if (!key || !s.read.includes(key)) return;
      s.read = s.read.filter((x) => x !== key);
      commit();
    },

    toggleRead(id) {
      const s = state();
      const key = String(id || '');
      if (!key) return;
      if (s.read.includes(key)) s.read = s.read.filter((x) => x !== key);
      else s.read = [...s.read, key];
      commit();
    },

    /** Study card self-assessment: grade 0..3. Only this word's state moves —
     *  the global theta is a calibration-time estimate, not a per-card reward. */
    gradeWord(word, grade) {
      const s = state();
      const first = !s.words[word.w];
      const st = E.applyGrade(s, word, grade);
      st.o = E.clamp((st.o || 0) + (grade === 0 ? 0.35 : grade === 1 ? 0.12 : -0.08), -3, 3);
      E.bumpDay(s, first ? 'new' : 'review');
      E.bumpDay(s, 'total');
      if (grade >= 2) E.bumpDay(s, 'correct');
      if (grade === 0) {
        s.wrong[word.w] = (s.wrong[word.w] || 0) + 1;
      } else if (grade >= 2 && s.wrong[word.w]) {
        delete s.wrong[word.w];
      }
      commit();
    },

    markKnown(word, manual = true) {
      const s = state();
      E.markKnown(s, word, manual);
      delete s.wrong[word.w];
      commit();
    },

    unmarkKnown(word) {
      E.unmarkKnown(state(), word);
      commit();
    },

    /** Sieve mode: 1 = 认识（退役）, 0.5 = 眼熟（推进队列）, 0 = 不认识（推进队列）。 */
    sieveAnswer(word, score) {
      const s = state();
      if (score >= 1) {
        E.markKnown(s, word, true);
      } else {
        const w = s.words[word.w] || (s.words[word.w] = { seen: 0, wrong: 0, o: 0 });
        w.o = E.clamp((w.o || 0) + (score >= 0.5 ? 0.4 : 0.9), -3, 4);
      }
      commit();
    },

    toggleFav(word) {
      const s = state();
      const i = s.fav.indexOf(word.w);
      if (i >= 0) s.fav.splice(i, 1);
      else s.fav.push(word.w);
      commit();
    },

    recordWrong(word) {      const s = state();
      s.wrong[word.w] = (s.wrong[word.w] || 0) + 1;
      commit();
    },

    clearWrong(word) {
      delete state().wrong[word.w];
      commit();
    },

    saveAttempt(paperId, attempt) {
      state().papers[paperId] = attempt;
      commit();
    },

    /** Replace-by-id append of imported questions. */
    importQuestions(items) {
      const s = state();
      const byId = new Map(s.custom.map((i) => [i.id, i]));
      for (const item of items) byId.set(item.id, item);
      s.custom = [...byId.values()];
      commit();
      return s.custom.length;
    },

    clearImported() {
      state().custom = [];
      commit();
    },

    setAI(patch) {
      Object.assign(state().ai, patch);
      commit();
    },

    addTokens(n) {
      state().ai.sessionTokens = (state().ai.sessionTokens || 0) + n;
      commit();
    },

    resetAll() {
      store.reset();
    },

    word(w) {
      return byWord.get(w) || null;
    },
  };
}
