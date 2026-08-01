import { pool, env } from '../config.js';
import { mapBot } from '../services/auth.js';
import { answerBotChat } from '../services/chatService.js';

export default async function publicRoutes(fastify) {
  fastify.get('/public/bots/:botId/config', async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM bots WHERE id = $1', [
      request.params.botId,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    const bot = mapBot(rows[0]);
    return {
      id: bot.id,
      name: bot.name,
      theme: bot.theme,
      iconUrl: bot.iconUrl,
      welcomeMessage: bot.welcomeMessage,
      suggestedQuestions: bot.suggestedQuestions,
      sourceCitations: bot.sourceCitations,
      status: bot.status,
    };
  });

  fastify.post('/public/bots/:botId/chat', async (request, reply) => {
    try {
      const result = await answerBotChat(request.params.botId, request.body?.message, {
        history: request.body?.history || [],
        language: request.body?.language,
      });
      return result;
    } catch (err) {
      return reply.code(err.statusCode || 500).send({
        error: 'chat_failed',
        message: err.message,
      });
    }
  });

  fastify.get('/embed/:botId.js', async (request, reply) => {
    const botId = request.params.botId;
    const api = env.publicApiUrl;
    const script = `
(function(){
  var BOT_ID = ${JSON.stringify(botId)};
  var API = ${JSON.stringify(api)};
  if (window.__DF_EMBED_LOADED__ && window.__DF_EMBED_LOADED__[BOT_ID]) return;
  window.__DF_EMBED_LOADED__ = window.__DF_EMBED_LOADED__ || {};
  window.__DF_EMBED_LOADED__[BOT_ID] = true;

  var SEND_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3V13M8 3L4.5 6.5M8 3L11.5 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function injectStyles() {
    if (document.getElementById('df-embed-styles')) return;
    var style = document.createElement('style');
    style.id = 'df-embed-styles';
    style.textContent = [
      '.df-launcher,.df-panel,.df-panel *{box-sizing:border-box}',
      '.df-launcher{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:10px;width:min(520px,calc(100vw - 2.5rem));min-height:44px;padding:5px 7px 5px 8px;margin:0;background:var(--df-launcher-bg,#fff);color:var(--df-text,#141413);border:1px solid rgba(20,20,19,.1);border-radius:999px;box-shadow:0 2px 12px rgba(20,20,19,.07),0 12px 36px rgba(20,20,19,.12);cursor:pointer;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.4;text-align:left;-webkit-appearance:none;appearance:none;transition:opacity .52s cubic-bezier(.16,1,.3,1),transform .58s cubic-bezier(.16,1,.3,1),box-shadow .35s ease}',
      '.df-launcher.df-launcher-hidden{opacity:0;transform:translateX(-50%) translateY(10px) scale(.985);pointer-events:none}',
      '.df-launcher.df-launcher-returning{animation:dfLauncherReturn .22s cubic-bezier(.22,1,.36,1) both}',
      '.df-launcher-avatar{flex-shrink:0;width:34px;height:34px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;line-height:0}',
      '.df-launcher-avatar img,.df-launcher-avatar svg{display:block;width:34px;height:34px}',
      '.df-launcher-field{flex:1;min-width:0;padding:3px 0;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4}',
      '.df-launcher-send{flex-shrink:0;width:34px;height:34px;border-radius:50%;background:rgba(20,20,19,.07);color:rgba(20,20,19,.4);display:flex;align-items:center;justify-content:center;pointer-events:none}',
      '.df-launcher-send svg{display:block;width:16px;height:16px}',
      '.df-panel{display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100000;width:min(520px,calc(100vw - 2.5rem));height:min(680px,calc(100svh - 4rem));background:var(--df-panel-bg,#faf9f5);color:var(--df-text,#141413);border-radius:22px;border:1px solid rgba(20,20,19,.06);box-shadow:0 4px 20px rgba(20,20,19,.08),0 24px 64px rgba(20,20,19,.16);font-family:system-ui,-apple-system,sans-serif;overflow:hidden;flex-direction:column}',
      '.df-panel.df-panel-opening{animation:dfPanelOpen .68s cubic-bezier(.16,1,.3,1) both}',
      '.df-panel.df-panel-closing{animation:dfPanelClose .48s cubic-bezier(.22,1,.36,1) forwards;pointer-events:none}',
      '.df-header{padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;min-height:48px}',
      '.df-header-title{display:flex;align-items:center;gap:10px;min-width:0}',
      '.df-header-title img,.df-header-title svg{width:32px;height:32px;border-radius:8px;display:block;flex-shrink:0}',
      '.df-header-title strong{font-size:14px;font-weight:600;letter-spacing:-.02em;line-height:1}',
      '.df-close-btn{background:rgba(20,20,19,.06);border:0;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;color:rgba(20,20,19,.55);padding:0;margin:0;line-height:0}',
      '.df-close-btn svg{width:16px;height:16px;display:block}',
      '.df-log{flex:1;min-height:0;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}',
      '.df-idle{display:flex;flex-direction:column;gap:10px;animation:dfIdleIn .38s cubic-bezier(.16,1,.3,1) both}',
      '.df-welcome-row{display:flex;align-items:flex-start;gap:8px;animation:dfWelcomeIn .34s cubic-bezier(.16,1,.3,1) both}',
      '.df-welcome-avatar{flex-shrink:0;line-height:0}',
      '.df-welcome-avatar img,.df-welcome-avatar svg{width:26px;height:26px;border-radius:8px;display:block}',
      '.df-bubble{max-width:85%;padding:10px 14px;border-radius:16px;white-space:pre-wrap;line-height:1.45;font-size:14px}',
      '.df-bubble-user{align-self:flex-end;border-radius:16px 16px 4px 16px;background:var(--df-user-bubble,var(--df-text,#141413));color:var(--df-user-fg,#fff)}',
      '.df-bubble-bot{align-self:flex-start;border-radius:16px 16px 16px 4px;background:#fff;color:var(--df-text,#141413);border:1px solid rgba(20,20,19,.1);box-shadow:0 1px 4px rgba(20,20,19,.05)}',
      '.df-msg{display:flex;flex-direction:column;gap:6px;max-width:100%}',
      '.df-msg-user{align-items:flex-end}',
      '.df-msg-bot{align-items:flex-start}',
      '.df-sources{align-self:stretch;padding:0 2px;font-size:12px;line-height:1.35;color:rgba(20,20,19,.55)}',
      '.df-sources-label{margin:0 0 4px;font-weight:600;font-size:11px;letter-spacing:.02em;text-transform:uppercase;color:rgba(20,20,19,.45)}',
      '.df-sources ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}',
      '.df-source-row{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;color:var(--df-text,#141413);text-decoration:none;opacity:.78;border-radius:8px;padding:2px 4px 2px 2px}',
      'a.df-source-row:hover{opacity:1;color:var(--df-accent,#d97757);background:rgba(20,20,19,.04)}',
      '.df-source-row.is-static{opacity:.62;cursor:default}',
      '.df-source-name{min-width:0;overflow-wrap:anywhere}',
      '.df-source-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex-shrink:0;color:#6a6256}',
      '.df-source-icon svg{width:16px;height:16px;display:block}',
      '.df-source-icon--pdf{color:#b42318}',
      '.df-source-icon--txt{color:#3b6ea5}',
      '.df-source-icon--md{color:#2f6b4f}',
      '.df-source-icon--doc{color:#6a6256}',
      '.df-source-icon--link{color:#6a6256}',
      '.df-footer{padding:6px 16px 14px;flex-shrink:0}',
      '.df-input-bar{display:flex;align-items:center;gap:6px;min-height:44px;background:#fff;border:1px solid rgba(20,20,19,.1);border-radius:999px;padding:5px 6px 5px 15px;box-shadow:0 2px 14px rgba(20,20,19,.06)}',
      '.df-input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:14px;color:#141413;padding:4px 0;margin:0;line-height:1.4;outline:none}',
      '.df-input::placeholder{color:rgba(20,20,19,.38)}',
      '.df-send-btn{width:34px;height:34px;border:0;border-radius:50%;background:rgba(20,20,19,.07);color:rgba(20,20,19,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;margin:0;line-height:0;transition:background .2s,color .2s}',
      '.df-send-btn.is-active{background:var(--df-accent,#d97757);color:#fff}',
      '.df-send-btn svg{display:block;width:16px;height:16px}',
      '.df-chips{display:flex;flex-direction:column;align-items:flex-start;gap:5px}',
      '.df-chips-below{padding-left:34px;animation:dfChipsIn .32s cubic-bezier(.16,1,.3,1) .12s both}',
      '.df-chip{border:0;border-radius:999px;padding:6px 13px;background:var(--df-user-bubble,var(--df-text,#141413));color:var(--df-user-fg,#faf9f5);font:inherit;font-size:12px;font-weight:500;line-height:1.25;cursor:pointer;text-align:left;max-width:100%;animation:dfChipIn .3s cubic-bezier(.16,1,.3,1) both}',
      '@keyframes dfIdleIn{from{opacity:0}to{opacity:1}}',
      '@keyframes dfWelcomeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes dfChipsIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes dfChipIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes dfPanelOpen{from{opacity:0;transform:translateX(-50%) translateY(20px) scale(.97)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',
      '@keyframes dfPanelClose{from{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}to{opacity:0;transform:translateX(-50%) translateY(16px) scale(.97)}}',
      '@keyframes dfLauncherReturn{from{opacity:.78;transform:translateX(-50%) translateY(8px) scale(.98)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function defaultAvatar(accent, size) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size || 34));
    svg.setAttribute('height', String(size || 34));
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('fill', 'none');
    svg.innerHTML = '<rect width="32" height="32" rx="8" fill="' + accent + '"/><circle cx="16" cy="14" r="7.5" fill="#fff5f0"/><circle cx="13" cy="13" r="1.35" fill="#141413"/><circle cx="19" cy="13" r="1.35" fill="#141413"/><path d="M12.5 16.5C14 18.2 18 18.2 19.5 16.5" stroke="#141413" stroke-width="1.2" stroke-linecap="round"/>';
    return svg;
  }

  function createAvatar(iconUrl, accent, size) {
    if (iconUrl) {
      var img = document.createElement('img');
      img.src = iconUrl;
      img.alt = '';
      img.width = size;
      img.height = size;
      return img;
    }
    return defaultAvatar(accent, size);
  }

  injectStyles();

  fetch(API + '/public/bots/' + BOT_ID + '/config')
    .then(function(r){ return r.json(); })
    .then(function(cfg){
      var theme = cfg.theme || {};
      var accent = theme.accent || '#d97757';
      var textColor = theme.textColor || '#141413';
      var userFg = (function (hex) {
        var raw = String(hex || '').replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(raw)) return '#faf9f5';
        function lin(c) {
          var v = parseInt(c, 16) / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        }
        var L =
          0.2126 * lin(raw.slice(0, 2)) +
          0.7152 * lin(raw.slice(2, 4)) +
          0.0722 * lin(raw.slice(4, 6));
        return L > 0.55 ? '#141413' : '#faf9f5';
      })(textColor);
      var showSources = !(cfg.sourceCitations && cfg.sourceCitations.showSources === false);
      var open = false;
      var isClosing = false;
      var messages = [];
      var hasUserSent = false;

      var launcher = document.createElement('button');
      launcher.type = 'button';
      launcher.className = 'df-launcher';
      launcher.style.setProperty('--df-launcher-bg', theme.launcherBg || '#fff');
      launcher.style.setProperty('--df-text', textColor);
      launcher.style.setProperty('--df-user-bubble', textColor);
      launcher.style.setProperty('--df-user-fg', userFg);
      launcher.style.setProperty('--df-accent', accent);

      var launcherAvatar = document.createElement('span');
      launcherAvatar.className = 'df-launcher-avatar';
      launcherAvatar.appendChild(createAvatar(cfg.iconUrl, accent, 34));

      var launcherField = document.createElement('span');
      launcherField.className = 'df-launcher-field';
      launcherField.textContent = 'Ask ' + (cfg.name || 'the bot') + '…';

      var launcherSend = document.createElement('span');
      launcherSend.className = 'df-launcher-send';
      launcherSend.innerHTML = SEND_ICON;

      launcher.appendChild(launcherAvatar);
      launcher.appendChild(launcherField);
      launcher.appendChild(launcherSend);

      var panel = document.createElement('div');
      panel.className = 'df-panel';
      panel.style.setProperty('--df-panel-bg', theme.panelBg || '#faf9f5');
      panel.style.setProperty('--df-text', textColor);
      panel.style.setProperty('--df-user-bubble', textColor);
      panel.style.setProperty('--df-user-fg', userFg);
      panel.style.setProperty('--df-accent', accent);

      var header = document.createElement('div');
      header.className = 'df-header';
      var headerTitle = document.createElement('div');
      headerTitle.className = 'df-header-title';
      headerTitle.appendChild(createAvatar(cfg.iconUrl, accent, 32));
      var title = document.createElement('strong');
      title.textContent = cfg.name || 'Assistant';
      headerTitle.appendChild(title);
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'df-close-btn';
      closeBtn.setAttribute('aria-label', 'Minimize chat');
      closeBtn.innerHTML = CLOSE_ICON;
      header.appendChild(headerTitle);
      header.appendChild(closeBtn);

      var chips = document.createElement('div');
      chips.className = 'df-chips df-chips-below';
      var chipIndex = 0;
      (cfg.suggestedQuestions || [])
        .map(function(q) { return String(q || '').trim(); })
        .filter(Boolean)
        .slice(0, 4)
        .forEach(function(q) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'df-chip';
        chip.textContent = q;
        chip.style.animationDelay = (0.18 + chipIndex * 0.06) + 's';
        chipIndex += 1;
        chip.addEventListener('click', function() {
          input.value = q;
          input.focus();
        });
        chips.appendChild(chip);
      });

      var log = document.createElement('div');
      log.className = 'df-log';

      var welcomeText = String(cfg.welcomeMessage || '').trim();
      if (welcomeText) {
        var welcomeRow = document.createElement('div');
        welcomeRow.className = 'df-welcome-row';
        var welcomeAvatar = document.createElement('span');
        welcomeAvatar.className = 'df-welcome-avatar';
        welcomeAvatar.appendChild(createAvatar(cfg.iconUrl, accent, 26));
        var welcomeBubble = document.createElement('div');
        welcomeBubble.className = 'df-bubble df-bubble-bot';
        welcomeBubble.textContent = welcomeText;
        welcomeRow.appendChild(welcomeAvatar);
        welcomeRow.appendChild(welcomeBubble);
        log.appendChild(welcomeRow);
      }
      if (chips.childNodes.length) log.appendChild(chips);

      function setChipsVisible(show) {
        if (!chips.childNodes.length) return;
        chips.style.display = show ? 'flex' : 'none';
      }
      setChipsVisible(false);

      var footer = document.createElement('div');
      footer.className = 'df-footer';
      var inputBar = document.createElement('div');
      inputBar.className = 'df-input-bar';
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'df-input';
      input.placeholder = 'Ask anything...';
      var sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'df-send-btn';
      sendBtn.setAttribute('aria-label', 'Send');
      sendBtn.innerHTML = SEND_ICON;
      inputBar.appendChild(input);
      inputBar.appendChild(sendBtn);
      footer.appendChild(inputBar);

      panel.appendChild(header);
      panel.appendChild(log);
      panel.appendChild(footer);

      function syncSendBtn() {
        sendBtn.classList.toggle('is-active', !!(input.value || '').trim());
      }

      function openPanel() {
        if (open || isClosing) return;
        open = true;
        launcher.classList.add('df-launcher-hidden');
        panel.classList.remove('df-panel-closing');
        panel.style.display = 'flex';
        panel.classList.add('df-panel-opening');
        setTimeout(function() {
          panel.classList.remove('df-panel-opening');
        }, 680);
        setChipsVisible(!hasUserSent);
      }

      function closePanel() {
        if (!open || isClosing) return;
        isClosing = true;
        panel.classList.add('df-panel-closing');
        setTimeout(function() {
          panel.classList.remove('df-panel-closing');
          panel.style.display = 'none';
          open = false;
          isClosing = false;
          launcher.classList.remove('df-launcher-hidden');
          launcher.classList.add('df-launcher-returning');
          setTimeout(function() {
            launcher.classList.remove('df-launcher-returning');
          }, 240);
        }, 480);
      }

      function sourceIconEl(source) {
        var type = String((source && source.type) || '').toLowerCase();
        var kind = String((source && source.kind) || (type === 'url' ? 'url' : 'file'));
        var label = String((source && (source.label || source.title)) || '').toLowerCase();
        var extMatch = label.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
        var ext = extMatch ? extMatch[1] : type === 'pdf' ? 'pdf' : type === 'txt' || type === 'text' ? 'txt' : '';
        var tone = 'doc';
        var mark = 'DOC';
        if (kind === 'url') {
          tone = 'link';
        } else if (ext === 'pdf' || type === 'pdf') {
          tone = 'pdf';
          mark = 'PDF';
        } else if (ext === 'txt' || ext === 'text' || type === 'txt' || type === 'text') {
          tone = 'txt';
          mark = 'TXT';
        } else if (ext === 'md' || ext === 'markdown') {
          tone = 'md';
          mark = 'MD';
        }
        var wrap = document.createElement('span');
        wrap.className = 'df-source-icon df-source-icon--' + tone;
        wrap.setAttribute('aria-hidden', 'true');
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', kind === 'url' ? '0 0 24 24' : '0 0 32 32');
        if (kind === 'url') {
          svg.innerHTML =
            '<path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
            '<path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.41a5 5 0 0 0 7.07 7.07L14 18.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
        } else {
          svg.innerHTML =
            '<path fill="currentColor" opacity="0.92" d="M8 2h11l7 7v19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>' +
            '<path fill="rgba(255,255,255,0.92)" d="M19 2v6a1 1 0 0 0 1 1h6"/>' +
            '<text x="16" y="23" text-anchor="middle" fill="rgba(255,255,255,0.96)" font-size="8" font-weight="700" font-family="ui-sans-serif, system-ui, sans-serif">' +
            mark +
            '</text>';
        }
        wrap.appendChild(svg);
        return wrap;
      }

      function addMsg(role, text, sources) {
        messages.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
        var wrap = document.createElement('div');
        wrap.className = 'df-msg ' + (role === 'user' ? 'df-msg-user' : 'df-msg-bot');
        var bubble = document.createElement('div');
        bubble.className = 'df-bubble ' + (role === 'user' ? 'df-bubble-user' : 'df-bubble-bot');
        bubble.textContent = text;
        wrap.appendChild(bubble);
        if (role !== 'user' && showSources && sources && sources.length) {
          var srcBox = document.createElement('div');
          srcBox.className = 'df-sources';
          var srcLabel = document.createElement('p');
          srcLabel.className = 'df-sources-label';
          srcLabel.textContent = 'Sources';
          srcBox.appendChild(srcLabel);
          var list = document.createElement('ul');
          sources.forEach(function(source) {
            var title = String((source && source.title) || 'Source').trim() || 'Source';
            var url = source && source.url ? String(source.url) : '';
            var li = document.createElement('li');
            var row = url ? document.createElement('a') : document.createElement('span');
            row.className = 'df-source-row' + (url ? '' : ' is-static');
            if (url) {
              row.href = url;
              row.target = '_blank';
              row.rel = 'noopener noreferrer';
            }
            row.title = String((source && source.label) || title);
            row.appendChild(sourceIconEl(source));
            var name = document.createElement('span');
            name.className = 'df-source-name';
            name.textContent = title;
            row.appendChild(name);
            li.appendChild(row);
            list.appendChild(li);
          });
          srcBox.appendChild(list);
          wrap.appendChild(srcBox);
        }
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
        if (role === 'user') {
          hasUserSent = true;
          setChipsVisible(false);
        }
      }

      function send() {
        var text = (input.value || '').trim();
        if (!text) return;
        input.value = '';
        syncSendBtn();
        addMsg('user', text);
        var history = messages.slice(0, -1);
        fetch(API + '/public/bots/' + BOT_ID + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: history })
        }).then(function(r){ return r.json(); }).then(function(data){
          addMsg('bot', data.answer || data.message || 'No answer', data.sources || []);
        }).catch(function(){
          addMsg('bot', 'Something went wrong. Please try again.');
        });
      }

      launcher.addEventListener('click', openPanel);
      closeBtn.addEventListener('click', closePanel);
      sendBtn.addEventListener('click', send);
      input.addEventListener('input', syncSendBtn);
      input.addEventListener('keydown', function(e){
        if (e.key === 'Enter') send();
      });

      document.body.appendChild(launcher);
      document.body.appendChild(panel);
      syncSendBtn();
    });
})();
`;
    reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(script);
  });
}
