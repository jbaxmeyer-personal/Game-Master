/**
 * D&D Master — main.js
 * Handles index.html: loading and displaying adventures/campaigns
 * from manifest files, and navigating to game.html.
 */

(function () {
  'use strict';

  /* ── DOM References ─────────────────────────────────────── */
  const adventuresCard  = document.getElementById('adventures-card');
  const campaignsCard   = document.getElementById('campaigns-card');
  const adventuresPanel = document.getElementById('adventures-panel');
  const campaignsPanel  = document.getElementById('campaigns-panel');
  const adventuresList  = document.getElementById('adventures-list');
  const campaignsList   = document.getElementById('campaigns-list');

  /* ── State ──────────────────────────────────────────────── */
  let activeMode = null; // 'adventures' | 'campaigns'

  /* ── Initialise ─────────────────────────────────────────── */
  function init() {
    adventuresCard.addEventListener('click', () => toggleMode('adventures'));
    campaignsCard.addEventListener('click',  () => toggleMode('campaigns'));

    // Keyboard accessibility
    adventuresCard.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggleMode('adventures'); });
    campaignsCard.addEventListener('keydown',  e => { if (e.key === 'Enter' || e.key === ' ') toggleMode('campaigns'); });
  }

  /* ── Toggle Mode ────────────────────────────────────────── */
  function toggleMode(mode) {
    if (activeMode === mode) {
      // Collapse if clicking the same card again
      deactivateMode();
      return;
    }
    activeMode = mode;

    // Update card states
    adventuresCard.classList.toggle('active', mode === 'adventures');
    campaignsCard.classList.toggle('active',  mode === 'campaigns');
    adventuresCard.setAttribute('aria-pressed', mode === 'adventures');
    campaignsCard.setAttribute('aria-pressed',  mode === 'campaigns');

    // Show the correct panel
    adventuresPanel.classList.toggle('visible', mode === 'adventures');
    campaignsPanel.classList.toggle('visible',  mode === 'campaigns');

    // Load content if not already loaded
    if (mode === 'adventures' && !adventuresList.dataset.loaded) {
      loadAdventures();
    }
    if (mode === 'campaigns' && !campaignsList.dataset.loaded) {
      loadCampaigns();
    }

    // Scroll panel into view smoothly
    const panel = mode === 'adventures' ? adventuresPanel : campaignsPanel;
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  function deactivateMode() {
    activeMode = null;
    adventuresCard.classList.remove('active');
    campaignsCard.classList.remove('active');
    adventuresCard.setAttribute('aria-pressed', 'false');
    campaignsCard.setAttribute('aria-pressed', 'false');
    adventuresPanel.classList.remove('visible');
    campaignsPanel.classList.remove('visible');
  }

  /* ── Load Adventures ────────────────────────────────────── */
  async function loadAdventures() {
    adventuresList.dataset.loaded = 'true';
    try {
      const manifest = await fetchJSON('adventures/manifest.json');
      if (!manifest || !manifest.length) {
        adventuresList.innerHTML = renderEmpty('No adventures available yet.');
        return;
      }

      // Fetch all adventure metadata in parallel
      const adventures = await Promise.all(
        manifest.map(id => fetchJSON(`adventures/${id}.json`))
      );

      adventuresList.innerHTML = '';
      adventures.forEach(adventure => {
        if (!adventure) return;
        adventuresList.appendChild(renderAdventureItem(adventure));
      });

      if (!adventuresList.children.length) {
        adventuresList.innerHTML = renderEmpty('Could not load adventures.');
      }
    } catch (err) {
      console.error('Failed to load adventures:', err);
      adventuresList.innerHTML = renderError('Failed to load adventures. Check the manifest file.');
    }
  }

  /* ── Load Campaigns ─────────────────────────────────────── */
  async function loadCampaigns() {
    campaignsList.dataset.loaded = 'true';
    try {
      const manifest = await fetchJSON('campaigns/manifest.json');
      if (!manifest || !manifest.length) {
        campaignsList.innerHTML = renderEmpty('No campaigns available yet.');
        return;
      }

      const campaigns = await Promise.all(
        manifest.map(id => fetchJSON(`campaigns/${id}/campaign.json`))
      );

      campaignsList.innerHTML = '';
      campaigns.forEach(campaign => {
        if (!campaign) return;
        campaignsList.appendChild(renderCampaignItem(campaign));
      });

      if (!campaignsList.children.length) {
        campaignsList.innerHTML = renderEmpty('Could not load campaigns.');
      }
    } catch (err) {
      console.error('Failed to load campaigns:', err);
      campaignsList.innerHTML = renderError('Failed to load campaigns. Check the manifest file.');
    }
  }

  /* ── Render: Adventure Item ─────────────────────────────── */
  function renderAdventureItem(adventure) {
    const item = document.createElement('div');
    item.className = 'content-item parchment fade-in';

    const diffClass = getDifficultyClass(adventure.difficulty);
    const hasSave = hasSavedProgress('adventure', adventure.id);

    item.innerHTML = `
      <div class="content-item-info">
        <h3>${escapeHtml(adventure.title)}</h3>
        <p>${escapeHtml(adventure.description)}</p>
      </div>
      <div class="content-item-meta">
        <span class="difficulty-badge ${diffClass}">${escapeHtml(adventure.difficulty || 'Unknown')}</span>
        ${adventure.recommended_players ? `<span class="meta-tag">&#9876; ${escapeHtml(adventure.recommended_players)} players</span>` : ''}
        ${adventure.estimated_time ? `<span class="meta-tag">&#9200; ${escapeHtml(adventure.estimated_time)}</span>` : ''}
      </div>
      <div class="content-item-actions">
        ${hasSave
          ? `<button class="btn btn-primary btn-launch" data-action="continue">Continue &#8250;</button>
             <button class="btn btn-ghost btn-launch" data-action="restart">Start Over</button>`
          : `<button class="btn btn-primary btn-launch" data-action="continue">Play &#8250;</button>`
        }
      </div>
    `;

    item.querySelector('[data-action="continue"]').addEventListener('click', () => launchAdventure(adventure.id));
    item.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
      clearSavedProgress('adventure', adventure.id);
      launchAdventure(adventure.id);
    });

    return item;
  }

  /* ── Render: Campaign Item ──────────────────────────────── */
  function renderCampaignItem(campaign) {
    const item = document.createElement('div');
    item.className = 'content-item parchment fade-in';

    const diffClass = getDifficultyClass(campaign.difficulty);
    const sessionCount = campaign.sessions ? campaign.sessions.length : 0;
    const hasSave = hasSavedProgress('campaign', campaign.id);

    item.innerHTML = `
      <div class="content-item-info">
        <h3>${escapeHtml(campaign.title)}</h3>
        <p>${escapeHtml(campaign.description)}</p>
        ${sessionCount ? `
        <div class="session-list">
          <div class="session-list-title">Jump to Session</div>
          <div class="session-pills">
            ${campaign.sessions.map((s, i) => `
              <button class="session-pill" data-session-id="${escapeHtml(s.id)}" title="${escapeHtml(s.title)}">
                ${i + 1}. ${escapeHtml(s.title)}
              </button>
            `).join('')}
          </div>
        </div>` : ''}
      </div>
      <div class="content-item-meta">
        <span class="difficulty-badge ${diffClass}">${escapeHtml(campaign.difficulty || 'Unknown')}</span>
        ${campaign.recommended_players ? `<span class="meta-tag">&#9876; ${escapeHtml(campaign.recommended_players)} players</span>` : ''}
        ${sessionCount ? `<span class="meta-tag">&#128218; ${sessionCount} sessions</span>` : ''}
      </div>
      <div class="content-item-actions">
        ${hasSave
          ? `<button class="btn btn-primary btn-launch" data-action="continue">Continue &#8250;</button>
             <button class="btn btn-ghost btn-launch" data-action="restart">Start Over</button>`
          : `<button class="btn btn-primary btn-launch" data-action="continue">Play &#8250;</button>`
        }
      </div>
    `;

    item.querySelector('[data-action="continue"]').addEventListener('click', () => launchCampaign(campaign.id));
    item.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
      clearSavedProgress('campaign', campaign.id);
      launchCampaign(campaign.id);
    });

    // Session pill clicks
    item.querySelectorAll('.session-pill').forEach(pill => {
      pill.addEventListener('click', () => launchCampaign(campaign.id, pill.dataset.sessionId));
    });

    return item;
  }

  /* ── Navigation ─────────────────────────────────────────── */
  function launchAdventure(id) {
    window.location.href = `game.html?type=adventure&id=${encodeURIComponent(id)}`;
  }

  function launchCampaign(id, sessionId) {
    let url = `game.html?type=campaign&id=${encodeURIComponent(id)}`;
    if (sessionId) {
      url += `&session=${encodeURIComponent(sessionId)}`;
    }
    window.location.href = url;
  }

  /* ── Save Progress Helpers ──────────────────────────────── */
  function hasSavedProgress(type, id) {
    try {
      return !!localStorage.getItem(`dndmaster_${type}_${id}`);
    } catch (e) {
      return false;
    }
  }

  function clearSavedProgress(type, id) {
    try {
      localStorage.removeItem(`dndmaster_${type}_${id}`);
    } catch (e) {}
  }

  /* ── Helpers ────────────────────────────────────────────── */
  async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  }

  function getDifficultyClass(difficulty) {
    if (!difficulty) return '';
    const d = difficulty.toLowerCase();
    if (d === 'beginner' || d === 'easy') return 'beginner';
    if (d === 'intermediate' || d === 'medium') return 'intermediate';
    if (d === 'hard' || d === 'expert') return 'hard';
    return 'beginner';
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderEmpty(msg) {
    return `<div class="text-center text-muted" style="padding: 2rem; font-style: italic;">${msg}</div>`;
  }

  function renderError(msg) {
    return `<div class="text-center" style="padding: 2rem; color: #c05050; font-style: italic;">${msg}</div>`;
  }

  /* ── Boot ───────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
