(() => {
  const $ = selector => document.querySelector(selector);
  const t = (key, values) => window.WIP_I18N.t(key, values);
  const cacheKey = 'wip-control-leaderboard-v1';
  const cacheTtlMs = 60_000;
  let manualRefreshUsed = false;
  let isLoading = false;

  function readCachedScores() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey));
      return cached && Date.now() - cached.savedAt < cacheTtlMs && Array.isArray(cached.scores)
        ? cached.scores
        : null;
    } catch {
      return null;
    }
  }

  function renderScores(scores) {
    const status = $('#leaderboardStatus');
    const list = $('#leaderboardRows');
    list.replaceChildren();
    if (!scores.length) {
      status.hidden = false;
      status.textContent = t('game.leaderboardEmpty');
      return;
    }
    scores.slice(0, 10).forEach((score, index) => {
      const item = document.createElement('li');
      item.className = 'leaderboard-entry';
      const rank = document.createElement('span');
      rank.className = 'leaderboard-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const player = document.createElement('span');
      player.className = 'leaderboard-player';
      const name = document.createElement('strong');
      name.textContent = score.nickname;
      player.append(name);
      const points = document.createElement('span');
      points.className = 'leaderboard-score';
      points.textContent = `${score.points}/${score.maxPoints}`;
      const accuracy = document.createElement('span');
      accuracy.className = 'leaderboard-accuracy';
      accuracy.textContent = `${score.accuracy}%`;
      const time = document.createElement('span');
      time.className = 'leaderboard-time';
      time.textContent = t('game.elapsed', { minutes: Math.floor(score.elapsedSeconds / 60), seconds: score.elapsedSeconds % 60 });
      const completedAt = score.completedAt
        ? new Intl.DateTimeFormat(window.WIP_I18N.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(score.completedAt))
        : '';
      const dateTime = document.createElement('span');
      dateTime.className = 'leaderboard-date-time';
      dateTime.textContent = completedAt;
      item.append(rank, player, points, accuracy, time, dateTime);
      list.append(item);
    });
    status.hidden = true;
  }

  async function loadScores(forceFresh = false) {
    const button = $('#leaderboardRefresh');
    const status = $('#leaderboardStatus');
    if (isLoading) return;
    isLoading = true;
    button.disabled = true;
    const cachedScores = forceFresh ? null : readCachedScores();
    if (cachedScores !== null) {
      renderScores(cachedScores);
      isLoading = false;
      button.disabled = manualRefreshUsed;
      return;
    }
    status.hidden = false;
    status.textContent = t('game.leaderboardLoading');
    try {
      const leaderboard = await window.WIP_LEADERBOARD_READY;
      const scores = await leaderboard.top();
      scores.sort((a, b) => b.points - a.points || b.accuracy - a.accuracy || a.elapsedSeconds - b.elapsedSeconds || (a.completedAt ?? 0) - (b.completedAt ?? 0));
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), scores }));
      } catch {}
      renderScores(scores);
    } catch {
      status.textContent = t('game.leaderboardError');
    } finally {
      isLoading = false;
      button.disabled = manualRefreshUsed;
    }
  }

  $('#languageSelect').addEventListener('change', event => {
    window.WIP_I18N.setLanguage(event.target.value);
    loadScores();
  });
  $('#leaderboardRefresh').addEventListener('click', () => {
    if (manualRefreshUsed || isLoading) return;
    manualRefreshUsed = true;
    loadScores(true);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    window.location.assign('index.html');
  });
  loadScores();
})();