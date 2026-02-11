/**
 * Sam AI — Chat Widget
 * Vanilla JS chat widget that connects to the Vercel serverless function.
 * Persists conversation in localStorage.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "samAiChat";
  const MAX_MESSAGES = 20;
  const MAX_INPUT_CHARS = 500;
  const WELCOME_MESSAGE =
    "Hi there! I'm Sam AI — I can answer questions about Sam's books, coaching, or anything on this site. What would you like to know?";
  const PROMPT_SUGGESTIONS = [
    "What are Sam's books about?",
    "Which book should I read first?",
    "Tell me about Sam's coaching",
    "How can Sam help me?"
  ];
  const BOOK_DATA = [
    {
      id: "the-policy",
      title: "The Policy",
      pattern: /\bThe Policy\b/i,
      cover: "/images/the-policy-front-cover.jpg",
      url: "https://www.amazon.co.uk/Policy-Sam-Murgatroyd-ebook/dp/B0FLZZ96WL/"
    },
    {
      id: "alienated",
      title: "Alienated",
      pattern: /\bAlienated\b/,
      cover: "/images/alienated-front-cover.jpg",
      url: "https://www.amazon.co.uk/Alienated-Sam-Murgatroyd/dp/B0CVF4BCDR/"
    },
    {
      id: "robins-bench",
      title: "Robin's Bench",
      pattern: /\bRobin'?s Bench\b/i,
      cover: "/images/robins-bench-front-cover.jpg",
      url: "https://www.amazon.co.uk/Robins-Bench-Sam-Murgatroyd/dp/B0FFGY7JP5/"
    }
  ];

  /* ---- Scroll lock (prevents page scrolling behind fullscreen chat on mobile) ---- */
  var scrollLockY = 0;
  function lockPageScroll() {
    try {
      if (!window.matchMedia || !window.matchMedia("(max-width: 768px)").matches) return;

      scrollLockY = window.scrollY || window.pageYOffset || 0;
      document.documentElement.classList.add("sam-chat-scroll-lock");
      document.body.style.position = "fixed";
      document.body.style.top = "-" + scrollLockY + "px";
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
    } catch (e) {}
  }

  function unlockPageScroll() {
    try {
      document.documentElement.classList.remove("sam-chat-scroll-lock");
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      if (scrollLockY) window.scrollTo(0, scrollLockY);
      scrollLockY = 0;
    } catch (e) {}
  }

  /* ---- Viewport helpers (prevents mobile UI bars clipping fixed widget) ---- */
  function updateViewportCssVars() {
    try {
      var vv = window.visualViewport;
      var vh = (vv ? vv.height : window.innerHeight) || 0;
      var vw = (vv ? vv.width : window.innerWidth) || 0;

      var vvBottom = 0;
      var vvRight = 0;
      if (vv) {
        var top = vv.offsetTop || 0;
        var left = vv.offsetLeft || 0;
        vvBottom = Math.max(0, (window.innerHeight || 0) - (vv.height + top));
        vvRight = Math.max(0, (window.innerWidth || 0) - (vv.width + left));
      }

      document.documentElement.style.setProperty("--sam-vh", vh + "px");
      document.documentElement.style.setProperty("--sam-vw", vw + "px");
      document.documentElement.style.setProperty("--sam-vv-bottom", vvBottom + "px");
      document.documentElement.style.setProperty("--sam-vv-right", vvRight + "px");
    } catch (e) {}
  }

  updateViewportCssVars();
  window.addEventListener("resize", updateViewportCssVars);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportCssVars);
    window.visualViewport.addEventListener("scroll", updateViewportCssVars);
  }

  /* ---- State ---- */
  let state = loadState();
  let isOpen = false;
  let isLoading = false;
  let welcomeShown = false;

  /* ---- Build DOM ---- */
  const toggle = document.createElement("button");
  toggle.className = "sam-chat-toggle";
  toggle.setAttribute("aria-label", "Open chat");
  toggle.innerHTML = chatIcon();

  const container = document.createElement("div");
  container.className = "sam-chat-container";
  container.innerHTML = `
    <div class="sam-chat-header">
      <div class="sam-chat-header-left">
        <span class="sam-chat-header-dot"></span>
        Sam AI
      </div>
      <div class="sam-chat-header-actions">
        <button class="sam-chat-new" title="New chat">New</button>
        <button class="sam-chat-close" title="Close">&times;</button>
      </div>
    </div>
    <div class="sam-chat-messages"></div>
    <button class="sam-chat-scroll-indicator" type="button" aria-label="Jump to latest">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 15l-7 7-7-7h4V4h6v11z"/>
      </svg>
    </button>
    <div class="sam-chat-input-area">
      <input class="sam-chat-input" type="text" placeholder="Ask about Sam's books or coaching..." />
      <input type="text" name="website" class="sam-chat-hp" autocomplete="off" tabindex="-1" aria-hidden="true" />
      <button class="sam-chat-send" aria-label="Send" disabled>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  `;

  /* ---- Get references IMMEDIATELY after creating DOM ---- */
  const messagesEl = container.querySelector(".sam-chat-messages");
  const inputEl = container.querySelector(".sam-chat-input");
  const honeypotEl = container.querySelector(".sam-chat-hp");
  const sendBtnEl = container.querySelector(".sam-chat-send");
  const closeBtn = container.querySelector(".sam-chat-close");
  const newBtn = container.querySelector(".sam-chat-new");
  const scrollIndicatorEl = container.querySelector(".sam-chat-scroll-indicator");

  /* ---- Auto-scroll control ---- */
  var shouldAutoScroll = true;
  var hasUnread = false;
  var autoScrollThreshold = 48; // px from bottom considered "at bottom"
  function isNearBottom() {
    var distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    return distance <= autoScrollThreshold;
  }
  function updateScrollIndicator() {
    if (!scrollIndicatorEl) return;
    var show = hasUnread && !isNearBottom();
    scrollIndicatorEl.classList.toggle("visible", show);
  }
  function markUnread() {
    hasUnread = true;
    updateScrollIndicator();
  }
  function clearUnread() {
    hasUnread = false;
    updateScrollIndicator();
  }
  messagesEl.addEventListener(
    "scroll",
    function () {
      shouldAutoScroll = isNearBottom();
      if (shouldAutoScroll) clearUnread();
      else updateScrollIndicator();
    },
    { passive: true }
  );
  if (scrollIndicatorEl) {
    scrollIndicatorEl.addEventListener("click", function () {
      shouldAutoScroll = true;
      clearUnread();
      scrollToBottom(true);
    });
  }

  /* ---- Hide honeypot (bot trap) ---- */
  if (honeypotEl) {
    honeypotEl.style.cssText = "position:absolute;left:-9999px;opacity:0;height:0;width:0;pointer-events:none;";
  }

  /* ---- Append to page ---- */
  document.body.appendChild(toggle);
  document.body.appendChild(container);

  /* ---- Restore saved messages ---- */
  if (state.messages.length > 0) {
    addMessageToDOM("assistant", WELCOME_MESSAGE);
    welcomeShown = true;
    state.messages.forEach(function (m) {
      addMessageToDOM(m.role, m.content);
    });
  }

  /* ---- Bind events ---- */
  toggle.addEventListener("click", toggleChat);
  closeBtn.addEventListener("click", toggleChat);
  newBtn.addEventListener("click", function () {
    resetState();
    initThread();
  });
  inputEl.setAttribute("maxlength", MAX_INPUT_CHARS);
  inputEl.addEventListener("input", function () {
    if (inputEl.value.length > MAX_INPUT_CHARS) {
      inputEl.value = inputEl.value.slice(0, MAX_INPUT_CHARS);
    }
    sendBtnEl.disabled = !inputEl.value.trim() || isLoading;
  });
  inputEl.addEventListener("focus", function () {
    updateViewportCssVars();
    setTimeout(scrollToBottom, 50);
    setTimeout(scrollToBottom, 250);
  });
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  sendBtnEl.addEventListener("click", function () {
    handleSend();
  });

  /* ---- localStorage ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed.threadId && Array.isArray(parsed.messages)) return parsed;
      }
    } catch (e) {}
    return { threadId: null, messages: [], seqToken: null };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function resetState() {
    state = { threadId: null, messages: [], seqToken: null };
    localStorage.removeItem(STORAGE_KEY);
    messagesEl.innerHTML = "";
    shouldAutoScroll = true;
    clearUnread();
    addMessageToDOM("assistant", WELCOME_MESSAGE);
    showPromptSuggestions();
    welcomeShown = true;
    inputEl.disabled = false;
  }

  /* ---- Icons ---- */
  function chatIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>';
  }

  function closeIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  }

  /* ---- Toggle ---- */
  function toggleChat() {
    isOpen = !isOpen;
    container.classList.toggle("visible", isOpen);
    toggle.classList.toggle("open", isOpen);
    toggle.setAttribute("aria-label", isOpen ? "Close chat" : "Open chat");
    toggle.innerHTML = isOpen ? closeIcon() : chatIcon();

    if (isOpen) {
      lockPageScroll();
      shouldAutoScroll = true;
      clearUnread();
      if (!welcomeShown) {
        addMessageToDOM("assistant", WELCOME_MESSAGE);
        showPromptSuggestions();
        welcomeShown = true;
      }
      if (!state.threadId) {
        initThread();
      }
      setTimeout(function () { inputEl.focus(); }, 150);
    } else {
      unlockPageScroll();
    }
  }

  /* ---- Init thread ---- */
  function initThread() {
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_thread", honeypot: honeypotEl?.value || "" }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.threadId) {
          state.threadId = data.threadId;
          state.seqToken = data.seqToken || null;
          saveState();
          console.log("Sam AI: Thread created");
        } else {
          console.error("Sam AI: No threadId in response", data);
        }
      })
      .catch(function (err) {
        console.error("Sam AI: Failed to create thread", err);
      });
  }

  /* ---- Send message ---- */
  function handleSend() {
    var text = inputEl.value.trim();
    if (!text || isLoading) {
      console.log("Sam AI: Send blocked", { text: !!text, isLoading: isLoading });
      return;
    }

    // Check limit
    var userCount = state.messages.filter(function (m) { return m.role === "user"; }).length;
    if (userCount >= MAX_MESSAGES / 2) {
      showLimitNotice();
      return;
    }

    // If no thread yet, create one first then send
    if (!state.threadId) {
      isLoading = true;
      sendBtnEl.disabled = true;
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_thread", honeypot: honeypotEl?.value || "" }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.threadId) {
            state.threadId = data.threadId;
            state.seqToken = data.seqToken || null;
            saveState();
            doSend(text);
          } else {
            isLoading = false;
            sendBtnEl.disabled = false;
            addMessageToDOM("assistant", "Sorry, I'm having trouble connecting. Please try again.");
          }
        })
        .catch(function () {
          isLoading = false;
          sendBtnEl.disabled = false;
          addMessageToDOM("assistant", "Sorry, I'm having trouble connecting. Please try again.");
        });
      return;
    }

    doSend(text);
  }

  function doSend(text) {
    // Remove prompt suggestions if present
    var prompts = messagesEl.querySelector(".sam-chat-prompts");
    if (prompts) prompts.remove();

    // Show user message
    addMessageToDOM("user", text);
    state.messages.push({ role: "user", content: text });
    saveState();
    shouldAutoScroll = true;
    clearUnread();
    scrollToBottom(true);

    inputEl.value = "";
    sendBtnEl.disabled = true;
    isLoading = true;

    var typingEl = showTyping();

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: state.threadId, message: text, honeypot: honeypotEl?.value || "", seqToken: state.seqToken || "" }),
    })
      .then(function (res) {
        typingEl.remove();
        if (!res.ok) {
          return res.json().then(function (data) {
            var errorMsg = data.error || "HTTP " + res.status;
            console.error("Sam AI: API error:", errorMsg);
            addMessageToDOM("assistant", errorMsg);
            isLoading = false;
            sendBtnEl.disabled = !inputEl.value.trim();
          });
        }

        var msgEl = addMessageToDOM("assistant", "");
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var fullText = "";

        function readChunk() {
          return reader.read().then(function (result) {
            if (result.done) {
              if (fullText) {
                // Strip citations before saving
                var cleanText = fullText.replace(/【[^】]*】/g, "").replace(/ {2,}/g, " ").trim();
                state.messages.push({ role: "assistant", content: cleanText });
                saveState();
                msgEl.innerHTML = formatMessage(fullText) + detectBookCards(fullText);
              }
              isLoading = false;
              sendBtnEl.disabled = !inputEl.value.trim();
              scrollToBottom();
              if (!isNearBottom()) {
                markUnread();
              } else {
                clearUnread();
              }
              return;
            }

            var chunk = decoder.decode(result.value, { stream: true });
            var lines = chunk.split("\n");
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (!line.startsWith("data: ")) continue;
              var data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                var parsed = JSON.parse(data);
                if (parsed.text) {
                  fullText += parsed.text;
                  // Strip complete + trailing incomplete citations during streaming
                  msgEl.textContent = fullText.replace(/【[^】]*】/g, "").replace(/【[^】]*$/, "");
                  scrollToBottom();
                }
                if (parsed.seqToken) {
                  // Update sequential token for next request
                  state.seqToken = parsed.seqToken;
                  saveState();
                }
                if (parsed.error) {
                  msgEl.textContent = parsed.error;
                }
              } catch (e) {}
            }
            return readChunk();
          });
        }

        return readChunk();
      })
      .catch(function (err) {
        if (typingEl.parentNode) typingEl.remove();
        console.error("Sam AI: Send failed", err);
        addMessageToDOM("assistant", "Sorry, something went wrong. Please try again.");
        isLoading = false;
        sendBtnEl.disabled = !inputEl.value.trim();
      });
  }

  /* ---- DOM helpers ---- */
  function addMessageToDOM(role, content) {
    var el = document.createElement("div");
    el.className = "sam-chat-msg " + role;
    if (role === "assistant") {
      el.innerHTML = formatMessage(content) + detectBookCards(content);
    } else {
      el.textContent = content;
    }
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function showPromptSuggestions() {
    var existing = messagesEl.querySelector(".sam-chat-prompts");
    if (existing) existing.remove();
    var wrap = document.createElement("div");
    wrap.className = "sam-chat-prompts";
    PROMPT_SUGGESTIONS.forEach(function (prompt) {
      var btn = document.createElement("button");
      btn.className = "sam-chat-prompt-btn";
      btn.textContent = prompt;
      btn.addEventListener("click", function () {
        wrap.remove();
        inputEl.value = prompt;
        handleSend();
      });
      wrap.appendChild(btn);
    });
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function showTyping() {
    var el = document.createElement("div");
    el.className = "sam-chat-typing";
    el.innerHTML =
      '<span class="sam-chat-typing-dot"></span>' +
      '<span class="sam-chat-typing-dot"></span>' +
      '<span class="sam-chat-typing-dot"></span>';
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function showLimitNotice() {
    var el = document.createElement("div");
    el.className = "sam-chat-limit";
    el.innerHTML =
      'You\'ve reached the chat limit for this session. <br>' +
      '<a href="#contact">Contact Sam directly</a> for a deeper conversation, ' +
      'or press <strong>New</strong> to start a fresh chat.';
    messagesEl.appendChild(el);
    scrollToBottom();
    inputEl.disabled = true;
  }

  function scrollToBottom() {
    var force = arguments.length > 0 && arguments[0] === true;
    requestAnimationFrame(function () {
      if (!force && !shouldAutoScroll) return;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatMessage(text) {
    if (!text) return "";
    // Strip file_search citations like 【4:13†Alienated Book.docx】
    text = text.replace(/【[^】]*】/g, "").replace(/ {2,}/g, " ").trim();
    var escaped = escapeHtml(text);
    // Strip markdown formatting to keep it conversational
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, "$1");
    escaped = escaped.replace(/\*([^*\n]+)\*/g, "$1");
    escaped = escaped.replace(/^#{1,6}\s+/gm, "");
    escaped = escaped.replace(/^[-*]\s+/gm, "");
    escaped = escaped.replace(/^\d+\.\s+/gm, "");
    // URLs — Amazon gets a clean label, others show raw
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, function (url) {
      if (url.indexOf("amazon.co.uk") !== -1) {
        return '<a href="' + url + '" target="_blank" rel="noopener" class="sam-chat-amazon-link">View on Amazon \u2192</a>';
      }
      return '<a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>";
    });
    // Line breaks
    escaped = escaped.replace(/\n/g, "<br>");
    return escaped;
  }

  function detectBookCards(text) {
    if (!text) return "";
    var html = "";
    var found = [];
    BOOK_DATA.forEach(function (book) {
      if (book.pattern.test(text)) found.push(book);
    });
    if (found.length === 0) return "";
    html = '<div class="sam-chat-book-cards">';
    found.forEach(function (book) {
      html +=
        '<a class="sam-chat-book-card" href="' + book.url + '" target="_blank" rel="noopener">' +
        '<img src="' + book.cover + '" alt="' + book.title + '" />' +
        "<span>" + book.title + "</span></a>";
    });
    html += "</div>";
    return html;
  }
})();
