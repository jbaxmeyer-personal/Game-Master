/**
 * D&D Master — engine.js
 * The core DM engine for game.html.
 *
 * Reads adventure/campaign JSON from URL params:
 *   game.html?type=adventure&id=goblin-cave
 *   game.html?type=campaign&id=lost-mine
 *   game.html?type=campaign&id=lost-mine&session=session-1
 *
 * Handles:
 *  - Loading JSON data
 *  - Scene rendering with typewriter effect
 *  - Action selection (suggested + custom)
 *  - Roll resolution (skill check vs DC)
 *  - Save/restore progress via localStorage
 *  - Campaign session picking
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     DOM References
  ══════════════════════════════════════════════════════════ */
  const loadingState      = document.getElementById('loading-state');
  const errorState        = document.getElementById('error-state');
  const errorMessage      = document.getElementById('error-message');
  const sessionPicker     = document.getElementById('session-picker');
  const campaignDescDisplay = document.getElementById('campaign-desc-display');
  const sessionPickerList = document.getElementById('session-picker-list');
  const gameInterface     = document.getElementById('game-interface');
  const gameControls      = document.getElementById('game-controls');

  const gameTitleDisplay  = document.getElementById('game-title-display');
  const progressDisplay   = document.getElementById('progress-display');

  const sceneTitle        = document.getElementById('scene-title');
  const narrativeText     = document.getElementById('narrative-text');
  const dmNoteBox         = document.getElementById('dm-note-box');
  const dmNoteText        = document.getElementById('dm-note-text');

  const actionSection     = document.getElementById('action-section');
  const actionButtons     = document.getElementById('action-buttons');
  const rollSection       = document.getElementById('roll-section');
  const rollPrompt        = document.getElementById('roll-prompt');
  const rollSkillName     = document.getElementById('roll-skill-name');
  const rollDcDisplay     = document.getElementById('roll-dc-display');
  const rollResultInput   = document.getElementById('roll-result-input');
  const submitRollBtn     = document.getElementById('submit-roll-btn');
  const cancelRollBtn     = document.getElementById('cancel-roll-btn');

  const continueSection   = document.getElementById('continue-section');
  const continueBtn       = document.getElementById('continue-btn');

  const outcomeBox        = document.getElementById('outcome-box');
  const outcomeLabel      = document.getElementById('outcome-label');
  const outcomeText       = document.getElementById('outcome-text');
  const outcomeBonus      = document.getElementById('outcome-bonus');
  const outcomeNextBtn    = document.getElementById('outcome-next-btn');

  const endScreen         = document.getElementById('end-screen');
  const endNarrativeText  = document.getElementById('end-narrative-text');
  const endDmNote         = document.getElementById('end-dm-note');
  const endDmNoteText     = document.getElementById('end-dm-note-text');
  const restartBtn        = document.getElementById('restart-btn');

  const toggleDmNoteBtn   = document.getElementById('toggle-dm-note-btn');
  const saveProgressBtn   = document.getElementById('save-progress-btn');

  /* ══════════════════════════════════════════════════════════
     State
  ══════════════════════════════════════════════════════════ */
  const state = {
    type: null,           // 'adventure' | 'campaign'
    id: null,             // adventure or campaign id
    sessionId: null,      // current session id (campaigns)
    data: null,           // the loaded JSON object (adventure or session)
    campaignData: null,   // campaign metadata (campaigns only)
    currentSceneId: null,
    currentScene: null,
    selectedAction: null, // the action object the player chose
    isCustomAction: false,
    dmNotesVisible: false,
    typewriterTimer: null,
    sceneCount: 0,
    totalScenes: 0,
  };

  /* ══════════════════════════════════════════════════════════
     Boot
  ══════════════════════════════════════════════════════════ */
  async function boot() {
    const params = new URLSearchParams(window.location.search);
    state.type      = params.get('type');
    state.id        = params.get('id');
    state.sessionId = params.get('session');

    if (!state.type || !state.id) {
      showError('No adventure or campaign specified. Please return to the menu.');
      return;
    }

    try {
      if (state.type === 'adventure') {
        await loadAdventure();
      } else if (state.type === 'campaign') {
        await loadCampaign();
      } else {
        showError('Unknown content type. Please return to the menu.');
      }
    } catch (err) {
      console.error('Boot error:', err);
      showError('Failed to load the adventure data. ' + err.message);
    }
  }

  /* ══════════════════════════════════════════════════════════
     Loaders
  ══════════════════════════════════════════════════════════ */
  async function loadAdventure() {
    const data = await fetchJSON(`adventures/${state.id}.json`);
    state.data = data;
    state.totalScenes = Object.keys(data.scenes || {}).length;

    gameTitleDisplay.textContent = data.title;
    document.title = `D&D Master — ${data.title}`;

    // Check for saved progress
    const saved = loadProgress();
    const startScene = saved ? saved.sceneId : data.starting_scene;

    hideLoading();
    showGameInterface();
    goToScene(startScene);
  }

  async function loadCampaign() {
    const campaign = await fetchJSON(`campaigns/${state.id}/campaign.json`);
    state.campaignData = campaign;

    document.title = `D&D Master — ${campaign.title}`;
    gameTitleDisplay.textContent = campaign.title;

    // If a specific session was requested via URL, go there
    if (state.sessionId) {
      await loadSession(state.sessionId);
      return;
    }

    // Check for saved progress
    const saved = loadProgress();
    if (saved && saved.sessionId) {
      await loadSession(saved.sessionId, saved.sceneId);
      return;
    }

    // No session requested or saved — show picker
    hideLoading();
    showSessionPicker(campaign);
  }

  async function loadSession(sessionId, resumeSceneId) {
    const session = campaign_findSession(sessionId);
    if (!session) {
      showError(`Session "${sessionId}" not found in campaign.`);
      return;
    }

    const sessionData = await fetchJSON(`campaigns/${state.id}/${session.file}`);
    state.data = sessionData;
    state.sessionId = sessionId;
    state.totalScenes = Object.keys(sessionData.scenes || {}).length;

    const startScene = resumeSceneId || sessionData.starting_scene;

    hideLoading();
    showGameInterface();
    goToScene(startScene);
  }

  function campaign_findSession(id) {
    if (!state.campaignData || !state.campaignData.sessions) return null;
    return state.campaignData.sessions.find(s => s.id === id) || null;
  }

  /* ══════════════════════════════════════════════════════════
     Session Picker UI
  ══════════════════════════════════════════════════════════ */
  function showSessionPicker(campaign) {
    campaignDescDisplay.textContent = campaign.description || '';
    sessionPickerList.innerHTML = '';

    campaign.sessions.forEach((session, index) => {
      const item = document.createElement('div');
      item.className = 'session-picker-item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      item.innerHTML = `
        <span class="session-num">Session ${index + 1}</span>
        <span class="session-name">${escapeHtml(session.title)}</span>
        <span class="content-item-arrow" aria-hidden="true">&#8250;</span>
      `;

      const launch = async () => {
        showLoadingInline();
        try {
          await loadSession(session.id);
        } catch (err) {
          showError('Could not load session: ' + err.message);
        }
      };
      item.addEventListener('click', launch);
      item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') launch(); });

      sessionPickerList.appendChild(item);
    });

    sessionPicker.style.display = 'block';
  }

  /* ══════════════════════════════════════════════════════════
     Scene Rendering
  ══════════════════════════════════════════════════════════ */
  function goToScene(sceneId) {
    const scenes = state.data.scenes;
    if (!scenes || !scenes[sceneId]) {
      showError(`Scene "${sceneId}" not found in this adventure.`);
      return;
    }

    state.currentSceneId = sceneId;
    state.currentScene   = scenes[sceneId];
    state.selectedAction = null;
    state.isCustomAction = false;
    state.sceneCount++;

    // Save progress automatically
    saveProgress();

    renderScene(state.currentScene);
  }

  function renderScene(scene) {
    // Hide outcome, roll, continue, end screen
    hideOutcome();
    hideRollSection();
    hideContinueSection();
    endScreen.style.display = 'none';

    // Scene header
    sceneTitle.textContent = scene.title || '';

    // DM Note
    if (scene.dm_note) {
      dmNoteText.textContent = scene.dm_note;
      dmNoteBox.style.display = state.dmNotesVisible ? 'block' : 'none';
    } else {
      dmNoteBox.style.display = 'none';
    }

    // Progress
    updateProgress();

    // Narrative — typewriter
    startTypewriter(scene.narrative || '');

    // Actions will be rendered after typewriter (or immediately for instant)
    hideActionSection();

    if (scene.is_end) {
      renderEndScene(scene);
    } else {
      // Show actions after narrative animation
      scheduleActionRender(scene);
    }
  }

  function renderEndScene(scene) {
    // Show narrative, then end screen
    const delay = Math.min(scene.narrative.length * TYPEWRITER_SPEED + 600, 4000);
    setTimeout(() => {
      gameInterface.querySelector('.action-section').style.display = 'none';
      endNarrativeText.textContent = scene.dm_note ? '' : (scene.narrative || '');
      if (scene.dm_note) {
        endDmNoteText.textContent = scene.dm_note;
        endDmNote.style.display = 'block';
      } else {
        endDmNote.style.display = 'none';
      }
      endScreen.style.display = 'block';
      endScreen.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, delay);
  }

  function scheduleActionRender(scene) {
    // Show actions while or just after typewriter finishes
    const narrativeLen = (scene.narrative || '').length;
    const showDelay = Math.min(narrativeLen * TYPEWRITER_SPEED + 300, 3500);

    setTimeout(() => {
      renderActions(scene);
    }, showDelay);
  }

  /* ══════════════════════════════════════════════════════════
     Typewriter Effect
  ══════════════════════════════════════════════════════════ */
  const TYPEWRITER_SPEED = 18; // ms per character

  function startTypewriter(text) {
    // Clear any previous
    if (state.typewriterTimer) clearTimeout(state.typewriterTimer);
    narrativeText.innerHTML = '';

    let i = 0;
    const cursor = document.createElement('span');
    cursor.className = 'typewriter-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    narrativeText.appendChild(cursor);

    // For long texts, chunk into paragraphs and render faster
    // Split on double newlines or sentences for paragraph support
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

    if (paragraphs.length > 1) {
      typewriterParagraphs(paragraphs, cursor);
    } else {
      typewriterSimple(text, cursor);
    }
  }

  function typewriterSimple(text, cursor) {
    let i = 0;
    const textNode = document.createTextNode('');
    narrativeText.insertBefore(textNode, cursor);

    function tick() {
      if (i < text.length) {
        // Burst a few chars at once for speed
        const burst = text[i] === ' ' ? 1 : 2;
        textNode.data += text.slice(i, i + burst);
        i += burst;
        state.typewriterTimer = setTimeout(tick, TYPEWRITER_SPEED);
      } else {
        cursor.remove();
      }
    }
    tick();
  }

  function typewriterParagraphs(paragraphs, cursor) {
    let pIndex = 0;

    function renderNextParagraph() {
      if (pIndex >= paragraphs.length) {
        cursor.remove();
        return;
      }

      const p = document.createElement('p');
      narrativeText.insertBefore(p, cursor);

      const text = paragraphs[pIndex].trim();
      pIndex++;
      let i = 0;

      function tick() {
        if (i < text.length) {
          const burst = text[i] === ' ' ? 1 : 2;
          p.textContent += text.slice(i, i + burst);
          i += burst;
          state.typewriterTimer = setTimeout(tick, TYPEWRITER_SPEED);
        } else {
          // Brief pause between paragraphs
          state.typewriterTimer = setTimeout(renderNextParagraph, 200);
        }
      }
      tick();
    }

    renderNextParagraph();
  }

  /* ══════════════════════════════════════════════════════════
     Action Rendering
  ══════════════════════════════════════════════════════════ */
  function renderActions(scene) {
    actionButtons.innerHTML = '';

    const actions = scene.suggested_actions || [];

    actions.forEach((action, index) => {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.setAttribute('data-index', index);

      const rollHint = action.check ? `${action.check} check` : '';

      btn.innerHTML = `
        <span class="action-indicator" aria-hidden="true"></span>
        <span class="action-label">${escapeHtml(action.label)}</span>
        ${rollHint ? `<span class="action-roll-hint">${escapeHtml(rollHint)}</span>` : ''}
      `;

      btn.addEventListener('click', () => selectAction(action, btn));
      actionButtons.appendChild(btn);
    });

    showActionSection();
  }

  function selectAction(action, buttonEl) {
    // Highlight selected
    actionButtons.querySelectorAll('.action-btn').forEach(b => b.classList.remove('selected'));
    if (buttonEl) buttonEl.classList.add('selected');

    state.selectedAction = action;
    state.isCustomAction = false;

    // Disable all action buttons
    setActionsDisabled(true);

    if (action.check) {
      showRollSection(action.check, action.dc);
    } else {
      // No roll needed — show continue button
      if (action.next_scene) {
        showContinueSection(() => goToScene(action.next_scene));
      }
    }
  }

  /* ══════════════════════════════════════════════════════════
     Roll Section
  ══════════════════════════════════════════════════════════ */
  function showRollSection(skill, dc) {
    hideContinueSection();
    hideOutcome();

    rollSkillName.textContent = skill || 'Skill';

    rollResultInput.value = '';
    rollSection.classList.add('visible');
    rollSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => rollResultInput.focus(), 400);
  }

  function hideRollSection() {
    rollSection.classList.remove('visible');
    rollResultInput.value = '';
  }

  function processRoll() {
    const rawValue = rollResultInput.value.trim();
    const rollResult = parseInt(rawValue, 10);

    if (isNaN(rollResult) || rollResult < 1) {
      shakeElement(rollResultInput);
      return;
    }

    const action = state.selectedAction;
    const skill  = action.check;
    const dc     = action.dc;

    const success = rollResult >= dc;
    hideRollSection();
    showOutcome(success, skill, action);
  }

  /* ══════════════════════════════════════════════════════════
     Continue Section
  ══════════════════════════════════════════════════════════ */
  function showContinueSection(callback) {
    continueSection.style.display = 'block';
    continueBtn.onclick = () => {
      hideContinueSection();
      if (callback) callback();
    };
  }

  function hideContinueSection() {
    continueSection.style.display = 'none';
  }

  /* ══════════════════════════════════════════════════════════
     Outcome Box
  ══════════════════════════════════════════════════════════ */
  function showOutcome(success, skill, action) {
    outcomeBox.classList.add('visible');
    outcomeBox.classList.remove('success', 'failure');

    const nextSceneId = success
      ? (action.success_scene || action.next_scene)
      : (action.failure_scene || action.next_scene);

    if (success) {
      outcomeBox.classList.add('success');
      outcomeLabel.innerHTML = '&#10003; Success';
      outcomeText.textContent = buildSuccessText(rollResult, skill);

      if (action.success_bonus) {
        outcomeBonus.textContent = action.success_bonus;
        outcomeBonus.style.display = 'block';
      } else {
        outcomeBonus.style.display = 'none';
      }
    } else {
      outcomeBox.classList.add('failure');
      outcomeLabel.innerHTML = '&#10007; Failure';
      outcomeText.textContent = buildFailureText(rollResult, skill);
      outcomeBonus.style.display = 'none';
    }

    if (nextSceneId) {
      outcomeNextBtn.textContent = 'Next Scene →';
      outcomeNextBtn.onclick = () => {
        hideOutcome();
        goToScene(nextSceneId);
      };
      outcomeNextBtn.style.display = 'inline-block';
    } else {
      outcomeNextBtn.style.display = 'none';
    }

    outcomeBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideOutcome() {
    outcomeBox.classList.remove('visible', 'success', 'failure');
  }

  function buildSuccessText(roll, skill) {
    return `Your ${skill} check succeeds — well done.`;
  }

  function buildFailureText(roll, skill) {
    return `Your ${skill} check falls short. Things do not go as planned.`;
  }

  /* ══════════════════════════════════════════════════════════
     UI Helpers
  ══════════════════════════════════════════════════════════ */
  function showLoadingInline() {
    sessionPicker.style.display = 'none';
    loadingState.style.display  = 'flex';
  }

  function hideLoading() {
    loadingState.style.display = 'none';
  }

  function showGameInterface() {
    gameInterface.style.display = 'block';
    gameControls.style.display  = 'flex';
  }

  function showActionSection() {
    actionSection.style.display = 'block';
    actionSection.classList.add('fade-in');
  }

  function hideActionSection() {
    actionSection.style.display = 'none';
    actionSection.classList.remove('fade-in');
  }

  function setActionsDisabled(disabled) {
    actionButtons.querySelectorAll('.action-btn').forEach(b => {
      b.disabled = disabled;
    });
  }

  function showError(msg) {
    hideLoading();
    sessionPicker.style.display  = 'none';
    gameInterface.style.display  = 'none';
    gameControls.style.display   = 'none';
    errorMessage.textContent     = msg;
    errorState.style.display     = 'block';
  }

  function updateProgress() {
    if (!state.data) return;
    const dataTitle = state.data.title || state.campaignData?.title || '';

    if (state.type === 'campaign' && state.campaignData) {
      const sessions = state.campaignData.sessions || [];
      const sessionIndex = sessions.findIndex(s => s.id === state.sessionId);
      const sessionNum = sessionIndex >= 0 ? sessionIndex + 1 : '?';
      progressDisplay.textContent = `Session ${sessionNum} of ${sessions.length}`;
    } else {
      // Count visited scenes roughly using sceneCount
      progressDisplay.textContent = `Scene ${state.sceneCount}`;
    }
  }

  function shakeElement(el) {
    el.style.borderColor = '#c0392b';
    el.style.animation = 'none';
    el.getBoundingClientRect(); // reflow
    el.style.animation = 'shake 0.4s ease';
    setTimeout(() => {
      el.style.borderColor = '';
      el.style.animation = '';
    }, 400);
  }

  /* ══════════════════════════════════════════════════════════
     Save / Load Progress (localStorage)
  ══════════════════════════════════════════════════════════ */
  function saveKey() {
    if (state.type === 'campaign') {
      return `dndmaster_campaign_${state.id}`;
    }
    return `dndmaster_adventure_${state.id}`;
  }

  function saveProgress() {
    try {
      const payload = {
        sceneId:   state.currentSceneId,
        sessionId: state.sessionId,
        savedAt:   Date.now(),
      };
      localStorage.setItem(saveKey(), JSON.stringify(payload));
    } catch (e) {
      // localStorage may be unavailable in some contexts
    }
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(saveKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearProgress() {
    try {
      localStorage.removeItem(saveKey());
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════
     Restart
  ══════════════════════════════════════════════════════════ */
  function restart() {
    clearProgress();
    state.sceneCount = 0;
    state.selectedAction = null;
    state.isCustomAction = false;

    if (state.type === 'adventure') {
      endScreen.style.display = 'none';
      hideOutcome();
      hideRollSection();
      hideContinueSection();
      showGameInterface();
      goToScene(state.data.starting_scene);
    } else {
      // Campaign: go back to session picker
      endScreen.style.display  = 'none';
      gameInterface.style.display = 'none';
      gameControls.style.display  = 'none';
      showSessionPicker(state.campaignData);
    }
  }

  /* ══════════════════════════════════════════════════════════
     Escape HTML helper
  ══════════════════════════════════════════════════════════ */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ══════════════════════════════════════════════════════════
     Fetch helper
  ══════════════════════════════════════════════════════════ */
  async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
    return response.json();
  }

  /* ══════════════════════════════════════════════════════════
     Event Listeners
  ══════════════════════════════════════════════════════════ */
  function bindEvents() {
    // Submit roll
    submitRollBtn.addEventListener('click', processRoll);
    rollResultInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') processRoll();
    });

    // Cancel roll
    cancelRollBtn.addEventListener('click', () => {
      hideRollSection();
      hideContinueSection();
      setActionsDisabled(false);
      state.selectedAction = null;
      actionButtons.querySelectorAll('.action-btn').forEach(b => b.classList.remove('selected'));
    });

    // Outcome next
    // (onclick set dynamically in showOutcome)

    // Restart
    restartBtn.addEventListener('click', restart);

    // Toggle DM notes
    toggleDmNoteBtn.addEventListener('click', () => {
      state.dmNotesVisible = !state.dmNotesVisible;
      if (state.currentScene && state.currentScene.dm_note) {
        dmNoteBox.style.display = state.dmNotesVisible ? 'block' : 'none';
      }
      toggleDmNoteBtn.style.opacity = state.dmNotesVisible ? '1' : '0.6';
    });

    // Save progress manually
    saveProgressBtn.addEventListener('click', () => {
      saveProgress();
      showToast('Progress saved!');
    });
  }

  /* ══════════════════════════════════════════════════════════
     Toast notification
  ══════════════════════════════════════════════════════════ */
  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  /* ══════════════════════════════════════════════════════════
     Add shake animation to stylesheet dynamically
  ══════════════════════════════════════════════════════════ */
  function injectShakeAnimation() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes shake {
        0%   { transform: translateX(0); }
        20%  { transform: translateX(-6px); }
        40%  { transform: translateX(6px); }
        60%  { transform: translateX(-4px); }
        80%  { transform: translateX(4px); }
        100% { transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════
     Init
  ══════════════════════════════════════════════════════════ */
  function init() {
    injectShakeAnimation();
    bindEvents();
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
