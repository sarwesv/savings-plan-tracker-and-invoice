/* ==========================================================================
   SaveNest - Core Application Logic
   ========================================================================== */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Data State Definitions (Clean - No Test Data)
  // --------------------------------------------------------------------------
  const DEFAULT_USERS = [];
  const DEFAULT_PLANS = {};
  const DEFAULT_TRANSACTIONS = {};
  const DEFAULT_REQUESTS = [];

  // --------------------------------------------------------------------------
  // Application State Manager (LocalStorage Backed)
  // --------------------------------------------------------------------------
  const State = {
    currentUser: null,
    users: [],
    plans: {},
    transactions: {},
    requests: [],

    init() {
      // Purge old test emails & seed data from localStorage
      if (!localStorage.getItem('savenest_clean_v3')) {
        localStorage.removeItem('savenest_users');
        localStorage.removeItem('savenest_plans');
        localStorage.removeItem('savenest_transactions');
        localStorage.removeItem('savenest_requests');
        localStorage.removeItem('savenest_active_email');
        localStorage.setItem('savenest_clean_v3', 'true');
      }

      // Load users
      const savedUsers = localStorage.getItem('savenest_users');
      this.users = savedUsers ? JSON.parse(savedUsers) : DEFAULT_USERS;
      if (!savedUsers) this.saveUsers();

      // Load plans
      const savedPlans = localStorage.getItem('savenest_plans');
      this.plans = savedPlans ? JSON.parse(savedPlans) : DEFAULT_PLANS;
      if (!savedPlans) this.savePlans();

      // Load transactions
      const savedTx = localStorage.getItem('savenest_transactions');
      this.transactions = savedTx ? JSON.parse(savedTx) : DEFAULT_TRANSACTIONS;
      if (!savedTx) this.saveTransactions();

      // Load requests
      const savedReq = localStorage.getItem('savenest_requests');
      this.requests = savedReq ? JSON.parse(savedReq) : DEFAULT_REQUESTS;
      if (!savedReq) this.saveRequests();

      // Active user session
      const activeEmail = localStorage.getItem('savenest_active_email');
      if (activeEmail) {
        const found = this.users.find(u => u.email.toLowerCase() === activeEmail.toLowerCase());
        if (found) this.currentUser = found;
      }
    },

    saveUsers() {
      localStorage.setItem('savenest_users', JSON.stringify(this.users));
    },
    savePlans() {
      localStorage.setItem('savenest_plans', JSON.stringify(this.plans));
    },
    saveTransactions() {
      localStorage.setItem('savenest_transactions', JSON.stringify(this.transactions));
    },
    saveRequests() {
      localStorage.setItem('savenest_requests', JSON.stringify(this.requests));
    },

    setCurrentUser(user) {
      this.currentUser = user;
      localStorage.setItem('savenest_active_email', user.email);

      // Save/upsert user document to Cloud Firestore
      if (firebaseDb && window.FirebaseSDK && user && user.email) {
        try {
          const userLower = user.email.toLowerCase();
          window.FirebaseSDK.setDoc(window.FirebaseSDK.doc(firebaseDb, "users", userLower), {
            email: userLower,
            name: user.name || userLower.split('@')[0],
            provider: user.provider || 'email',
            registeredAt: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.log('Firestore user sync note:', e);
        }
      }
    },

    clearCurrentUser() {
      this.currentUser = null;
      localStorage.removeItem('savenest_active_email');
    },

    deleteUserAccount(email) {
      if (!email) return;
      const targetEmail = email.toLowerCase();
      
      // 1. Remove from user accounts registry
      this.users = this.users.filter(u => u.email.toLowerCase() !== targetEmail);
      this.saveUsers();

      // 2. Remove all plans matching email case-insensitively
      Object.keys(this.plans).forEach(key => {
        if (key.toLowerCase() === targetEmail) {
          delete this.plans[key];
        }
      });
      this.savePlans();

      // 3. Remove all transactions matching email case-insensitively
      Object.keys(this.transactions).forEach(key => {
        if (key.toLowerCase() === targetEmail) {
          delete this.transactions[key];
        }
      });
      this.saveTransactions();

      // 4. Remove all outgoing/incoming requests
      this.requests = this.requests.filter(r => 
        (r.requesterEmail && r.requesterEmail.toLowerCase() !== targetEmail) && 
        (r.recipientEmail && r.recipientEmail.toLowerCase() !== targetEmail)
      );
      this.saveRequests();

      // 5. Cloud Firestore Purge for deleted account
      if (firebaseDb && window.FirebaseSDK) {
        try {
          window.FirebaseSDK.getDocs(window.FirebaseSDK.collection(firebaseDb, "requests")).then(snapshot => {
            snapshot.forEach(docSnap => {
              const data = docSnap.data();
              if ((data.requesterEmail && data.requesterEmail.toLowerCase() === targetEmail) ||
                  (data.recipientEmail && data.recipientEmail.toLowerCase() === targetEmail)) {
                window.FirebaseSDK.deleteDoc(window.FirebaseSDK.doc(firebaseDb, "requests", docSnap.id));
              }
            });
          });
        } catch (e) {
          console.log('Firestore purge note:', e);
        }
      }

      if (this.currentUser && this.currentUser.email.toLowerCase() === targetEmail) {
        this.clearCurrentUser();
      }
    },

    getUserPlans(email) {
      if (!email) return [];
      const targetEmail = email.toLowerCase();
      const key = Object.keys(this.plans).find(k => k.toLowerCase() === targetEmail);
      return key ? (this.plans[key] || []) : [];
    },

    getUserTransactions(email) {
      if (!email) return [];
      const targetEmail = email.toLowerCase();
      const key = Object.keys(this.transactions).find(k => k.toLowerCase() === targetEmail);
      return key ? (this.transactions[key] || []) : [];
    },

    addPlan(plan) {
      if (!this.currentUser) return;
      const key = this.currentUser.email.toLowerCase();
      if (!this.plans[key]) this.plans[key] = [];
      this.plans[key].unshift(plan);
      this.savePlans();
    },

    deletePlan(planId) {
      if (!this.currentUser) return;
      const key = this.currentUser.email.toLowerCase();
      if (this.plans[key]) {
        this.plans[key] = this.plans[key].filter(p => p.id !== planId);
        this.savePlans();
      }
    },

    addTransaction(tx) {
      if (!this.currentUser) return;
      const key = this.currentUser.email.toLowerCase();
      if (!this.transactions[key]) this.transactions[key] = [];
      this.transactions[key].unshift(tx);

      // Update plan's saved total
      const userPlans = this.getUserPlans(key);
      const plan = userPlans.find(p => p.id === tx.planId);
      if (plan) {
        if (tx.type === 'deposit') {
          plan.currentSaved += Number(tx.amount);
        } else if (tx.type === 'withdrawal') {
          plan.currentSaved = Math.max(0, plan.currentSaved - Number(tx.amount));
        }
        this.savePlans();
      }
      this.saveTransactions();
    },

    addRequest(req) {
      this.requests.unshift(req);
      this.saveRequests();

      // Sync to Cloud Firestore Database
      if (firebaseDb && window.FirebaseSDK) {
        try {
          window.FirebaseSDK.setDoc(window.FirebaseSDK.doc(firebaseDb, "requests", req.id), req);
        } catch (e) {
          console.log("Firestore write note:", e);
        }
      }
    },

    updateRequestStatus(reqId, status, recipientMessage) {
      const req = this.requests.find(r => r.id === reqId);
      if (req) {
        req.status = status;
        req.recipientMessage = recipientMessage;
        req.updatedAt = new Date().toISOString();

        // Sync update to Cloud Firestore Database
        if (firebaseDb && window.FirebaseSDK) {
          try {
            window.FirebaseSDK.updateDoc(window.FirebaseSDK.doc(firebaseDb, "requests", reqId), {
              status: status,
              recipientMessage: recipientMessage,
              updatedAt: req.updatedAt
            });
          } catch (e) {
            console.log("Firestore update note:", e);
          }
        }

        // If request accepted and linked to a plan, automatically log transaction for requester
        if (status === 'accepted' && req.linkedPlanId) {
          const requesterPlans = this.getUserPlans(req.requesterEmail);
          const plan = requesterPlans.find(p => p.id === req.linkedPlanId);
          if (plan) {
            if (!this.transactions[req.requesterEmail]) this.transactions[req.requesterEmail] = [];
            this.transactions[req.requesterEmail].unshift({
              id: 'tx_' + Date.now(),
              planId: req.linkedPlanId,
              type: 'deposit',
              amount: req.amount,
              note: `Payment request fulfilled by ${req.recipientEmail}: ${req.reason}`,
              date: new Date().toISOString()
            });
            plan.currentSaved += Number(req.amount);
            this.savePlans();
            this.saveTransactions();
          }
        }

        this.saveRequests();
      }
    }
  };

  // --------------------------------------------------------------------------
  // UI Helpers & Formatting (Currency Selection Engine)
  // --------------------------------------------------------------------------
  const CURRENCY_MAP = {
    USD: { symbol: '$', code: 'USD' },
    EUR: { symbol: '€', code: 'EUR' },
    GBP: { symbol: '£', code: 'GBP' },
    CAD: { symbol: '$', code: 'CAD' },
    AUD: { symbol: '$', code: 'AUD' },
    INR: { symbol: '₹', code: 'INR' }
  };

  function getCurrencySymbol() {
    const cur = localStorage.getItem('savenest_currency') || 'USD';
    return CURRENCY_MAP[cur]?.symbol || '$';
  }

  function formatCurrency(num) {
    const symbol = getCurrencySymbol();
    const formattedVal = Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${symbol}${formattedVal}`;
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.borderColor = type === 'danger' ? 'var(--accent-rose)' : 'var(--accent-primary)';
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function openModal(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return;
    modalEl.classList.remove('hidden');
    if (window.gsap) {
      const content = modalEl.querySelector('.modal-content');
      if (content) {
        gsap.fromTo(content, { scale: 0.9, opacity: 0, y: 15 }, { scale: 1, opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.5)' });
      }
    }
  }

  function closeModal(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return;
    modalEl.classList.add('hidden');
  }

  // --------------------------------------------------------------------------
  // UI Renderer Engine
  // --------------------------------------------------------------------------
  function renderApp() {
    const authView = document.getElementById('authView');
    const appView = document.getElementById('appView');

    if (!State.currentUser) {
      authView.classList.remove('hidden');
      appView.classList.add('hidden');
      return;
    }

    authView.classList.add('hidden');
    appView.classList.remove('hidden');

    // Header info
    document.getElementById('headerUserName').textContent = State.currentUser.name;
    document.getElementById('headerUserEmail').textContent = State.currentUser.email;
    document.getElementById('headerAvatar').textContent = State.currentUser.avatar || State.currentUser.name.charAt(0);

    // Stats overview
    renderStats();

    // Render tab views
    renderPlansTab();
    renderTransactionsTab();
    renderRequestTabOptions();
    renderInboxTab();
    renderAnalyticsTab();
  }

  function renderStats() {
    const userEmail = State.currentUser.email;
    const plans = State.getUserPlans(userEmail);
    const totalSaved = plans.reduce((acc, p) => acc + (p.currentSaved || 0), 0);

    document.getElementById('statTotalSaved').textContent = formatCurrency(totalSaved);
    document.getElementById('statPlanCount').textContent = `Across ${plans.length} savings plan${plans.length === 1 ? '' : 's'}`;

    // Inbox stats & Unread Badge
    const incomingPending = State.requests.filter(r => r.recipientEmail && r.recipientEmail.toLowerCase() === userEmail.toLowerCase() && r.status === 'pending');
    document.getElementById('statPendingCount').textContent = incomingPending.length;

    const inboxBadge = document.getElementById('inboxBadge');
    if (inboxBadge) {
      if (incomingPending.length > 0) {
        inboxBadge.textContent = incomingPending.length;
        inboxBadge.classList.remove('hidden');
      } else {
        inboxBadge.classList.add('hidden');
      }
    }

    // Outbox stats
    const outgoing = State.requests.filter(r => r.requesterEmail && r.requesterEmail.toLowerCase() === userEmail.toLowerCase());
    const outgoingAccepted = outgoing.filter(r => r.status === 'accepted').length;
    document.getElementById('statOutboxAccepted').textContent = `${outgoingAccepted} Accepted`;
    document.getElementById('statOutboxTotal').textContent = `${outgoing.length} total request${outgoing.length === 1 ? '' : 's'} sent`;
  }

  function renderPlansTab() {
    const grid = document.getElementById('plansGrid');
    const plans = State.getUserPlans(State.currentUser.email);

    if (plans.length === 0) {
      grid.innerHTML = `
        <div class="glass-panel empty-state" style="grid-column: 1 / -1;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/>
          </svg>
          <h3 style="font-size: 1.1rem; color: var(--text-main); margin-bottom: 0.3rem;">No Savings Plans Yet</h3>
          <p style="font-size: 0.85rem; margin-bottom: 1.25rem;">Create a plan like "New Laptop Funds", set a target, and record initial saved money.</p>
          <button class="btn btn-primary" onclick="document.getElementById('openNewPlanModalBtn').click()">+ Create Your First Plan</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    plans.forEach(plan => {
      const percentage = Math.min(100, Math.round(((plan.currentSaved || 0) / plan.targetAmount) * 100));
      const card = document.createElement('div');
      card.className = 'glass-panel plan-card';
      card.innerHTML = `
        <div>
          <div class="plan-top">
            <div class="plan-category-icon">${plan.categoryIcon || '🎯'}</div>
            <div class="plan-actions">
              <button class="icon-btn delete-plan-btn" data-id="${plan.id}" title="Delete Plan">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>

          <h3 class="plan-title">${plan.title}</h3>
          <p class="plan-reason">${plan.reason}</p>
        </div>

        <div>
          <div class="plan-amounts">
            <span class="current-saved">${formatCurrency(plan.currentSaved)}</span>
            <span class="target-goal">Goal: ${formatCurrency(plan.targetAmount)} (${percentage}%)</span>
          </div>

          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${percentage}%;"></div>
          </div>

          <div class="plan-footer">
            <button class="btn btn-secondary log-deposit-quick" data-planid="${plan.id}">
              + Log Deposit
            </button>
            <button class="btn btn-primary req-for-plan-quick" data-planid="${plan.id}" data-title="${plan.title}">
              Request Funds
            </button>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });

    // Event listeners for plan action buttons
    grid.querySelectorAll('.delete-plan-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to delete this savings plan?')) {
          State.deletePlan(id);
          showToast('Savings plan deleted');
          renderApp();
        }
      });
    });

    grid.querySelectorAll('.log-deposit-quick').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const planId = e.currentTarget.getAttribute('data-planid');
        document.getElementById('txPlanId').value = planId;
        openModal('logTxModal');
      });
    });

    grid.querySelectorAll('.req-for-plan-quick').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const planId = e.currentTarget.getAttribute('data-planid');
        const planTitle = e.currentTarget.getAttribute('data-title');
        
        // Switch to request tab & set form defaults
        switchTab('request');
        document.getElementById('reqLinkPlan').value = planId;
        document.getElementById('reqReason').value = `Contribution for ${planTitle}`;
      });
    });
  }

  function renderTransactionsTab() {
    const tbody = document.getElementById('transactionsTableBody');
    const userTx = State.getUserTransactions(State.currentUser.email);
    const userPlans = State.getUserPlans(State.currentUser.email);

    if (userTx.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No transaction entries logged yet. Click "Log New Transaction" to record completed deposits or withdrawals.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    userTx.forEach(tx => {
      const plan = userPlans.find(p => p.id === tx.planId);
      const isDeposit = tx.type === 'deposit';
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      tr.innerHTML = `
        <td style="padding: 0.75rem; color: var(--text-muted);">${formatDate(tx.date)}</td>
        <td style="padding: 0.75rem; font-weight: 600;">${plan ? plan.title : 'General'}</td>
        <td style="padding: 0.75rem;">
          <span class="status-badge ${isDeposit ? 'status-accepted' : 'status-declined'}">
            ${isDeposit ? 'Deposit (+)' : 'Withdrawal (-)'}
          </span>
        </td>
        <td style="padding: 0.75rem; color: var(--text-main);">${tx.note}</td>
        <td style="padding: 0.75rem; text-align: right; font-weight: 700; color: ${isDeposit ? 'var(--accent-primary)' : 'var(--accent-rose)'};">
          ${isDeposit ? '+' : '-'}${formatCurrency(tx.amount)}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function getRecentRecipients() {
    if (!State.currentUser) return [];
    const key = `savenest_recent_emails_${State.currentUser.email.toLowerCase()}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
  }

  function addRecentRecipient(email) {
    if (!State.currentUser || !email) return;
    const key = `savenest_recent_emails_${State.currentUser.email.toLowerCase()}`;
    let list = getRecentRecipients();
    const target = email.toLowerCase().trim();
    list = list.filter(e => e !== target);
    list.unshift(target);
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem(key, JSON.stringify(list));
  }

  function renderRequestTabOptions() {
    // Populate linked plans dropdown
    const select = document.getElementById('reqLinkPlan');
    const plans = State.getUserPlans(State.currentUser.email);
    select.innerHTML = '<option value="">None (General Request)</option>';
    plans.forEach(p => {
      select.innerHTML += `<option value="${p.id}">${p.categoryIcon || '🎯'} ${p.title} (Goal: ${formatCurrency(p.targetAmount)})</option>`;
    });

    // Populate Recent Recipients
    const wrapper = document.getElementById('recentRecipientsWrapper');
    const container = document.getElementById('recentRecipientsContainer');
    if (!wrapper || !container) return;
    const recentList = getRecentRecipients();

    if (recentList && recentList.length > 0) {
      wrapper.style.display = 'block';
      container.innerHTML = '';
      recentList.forEach(email => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pill-btn';
        pill.style.fontSize = '0.78rem';
        pill.style.padding = '0.3rem 0.65rem';
        pill.textContent = email;
        pill.addEventListener('click', () => {
          document.getElementById('reqRecipientEmail').value = email;
        });
        container.appendChild(pill);
      });
    } else {
      wrapper.style.display = 'none';
    }
  }

  function renderInboxTab() {
    const userEmail = State.currentUser.email.toLowerCase();

    // 1. Incoming Requests
    const incomingContainer = document.getElementById('incomingRequestsContainer');
    const incoming = State.requests.filter(r => r.recipientEmail.toLowerCase() === userEmail);

    if (incoming.length === 0) {
      incomingContainer.innerHTML = `
        <div class="glass-panel empty-state">
          <p style="margin-bottom: 0;">No incoming payment requests in your inbox.</p>
        </div>
      `;
    } else {
      incomingContainer.innerHTML = '';
      incoming.forEach(req => {
        const card = document.createElement('div');
        card.className = `glass-panel request-card ${req.status}`;
        
        let statusBadgeText = 'PENDING YOUR RESPONSE';
        if (req.status === 'accepted') statusBadgeText = 'CONFIRMED / ACCEPTED';
        if (req.status === 'declined') statusBadgeText = 'DECLINED';

        card.innerHTML = `
          <div class="request-header">
            <div class="request-party">
              <div class="user-avatar" style="width: 26px; height: 26px; font-size: 0.72rem;">${req.requesterEmail.charAt(0).toUpperCase()}</div>
              <span><strong>From:</strong> ${req.requesterEmail}</span>
            </div>
            <span class="status-badge status-${req.status}">${statusBadgeText}</span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <div class="request-amount">${formatCurrency(req.amount)}</div>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${formatDate(req.createdAt)}</span>
          </div>

          <div class="request-reason">
            <strong>Reason:</strong> ${req.reason}
          </div>

          ${req.recipientMessage ? `
            <div class="request-message-quote">
              "Your response: ${req.recipientMessage}"
            </div>
          ` : ''}

          ${req.status === 'pending' ? `
            <button class="btn btn-primary open-reply-modal-btn" data-reqid="${req.id}">
              Respond / Reply to Request
            </button>
          ` : ''}
        `;

        incomingContainer.appendChild(card);
      });

      incomingContainer.querySelectorAll('.open-reply-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const reqId = e.currentTarget.getAttribute('data-reqid');
          openReplyModal(reqId);
        });
      });
    }

    // 2. Outgoing Requests (Sent by User)
    const outgoingContainer = document.getElementById('outgoingRequestsContainer');
    const outgoing = State.requests.filter(r => r.requesterEmail.toLowerCase() === userEmail);

    if (outgoing.length === 0) {
      outgoingContainer.innerHTML = `
        <div class="glass-panel empty-state">
          <p style="margin-bottom: 0;">You haven't sent any payment requests yet.</p>
        </div>
      `;
    } else {
      outgoingContainer.innerHTML = '';
      outgoing.forEach(req => {
        const card = document.createElement('div');
        card.className = `glass-panel request-card ${req.status}`;
        
        card.innerHTML = `
          <div class="request-header">
            <div class="request-party">
              <div class="user-avatar" style="width: 26px; height: 26px; font-size: 0.72rem; background: linear-gradient(135deg, var(--accent-blue), var(--accent-primary));">${req.recipientEmail.charAt(0).toUpperCase()}</div>
              <span><strong>Sent to:</strong> ${req.recipientEmail}</span>
            </div>
            <span class="status-badge status-${req.status}">${req.status.toUpperCase()}</span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <div class="request-amount">${formatCurrency(req.amount)}</div>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${formatDate(req.createdAt)}</span>
          </div>

          <div class="request-reason">
            <strong>Reason:</strong> ${req.reason}
          </div>

          ${req.recipientMessage ? `
            <div class="request-message-quote">
              💬 <strong>Recipient Response:</strong> "${req.recipientMessage}"
            </div>
          ` : `
            <div style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">
              Waiting for recipient to respond...
            </div>
          `}
        `;

        outgoingContainer.appendChild(card);
      });
    }
  }

  function openReplyModal(reqId) {
    const req = State.requests.find(r => r.id === reqId);
    if (!req) return;

    document.getElementById('replyRequestId').value = reqId;
    document.getElementById('replyDetailsBox').innerHTML = `
      <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;">Requested by ${req.requesterEmail}</div>
    `;
  }

  function renderAnalyticsTab() {
    if (!State.currentUser) return;
    const userEmail = State.currentUser.email;
    const plans = State.getUserPlans(userEmail);

    const totalTarget = plans.reduce((acc, p) => acc + (p.targetAmount || 0), 0);
    const totalSaved = plans.reduce((acc, p) => acc + (p.currentSaved || 0), 0);
    const remaining = Math.max(0, totalTarget - totalSaved);
    const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;
    const completedCount = plans.filter(p => (p.currentSaved || 0) >= (p.targetAmount || 1)).length;

    const pctEl = document.getElementById('analyticsCompletionPct');
    const barEl = document.getElementById('analyticsPortfolioBar');
    const remEl = document.getElementById('analyticsRemainingAmount');
    const compEl = document.getElementById('analyticsCompletedCount');

    if (pctEl) pctEl.textContent = `${overallPct}%`;
    if (barEl) {
      if (window.gsap) {
        gsap.to(barEl, { width: `${overallPct}%`, duration: 0.8, ease: 'power2.out' });
      } else {
        barEl.style.width = `${overallPct}%`;
      }
    }
    if (remEl) remEl.textContent = formatCurrency(remaining);
    if (compEl) compEl.textContent = completedCount;

    // Render Category Breakdown
    const catContainer = document.getElementById('categoryBreakdownContainer');
    if (catContainer) {
      if (plans.length === 0) {
        catContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No active savings plans found. Create a plan to view category analytics.</p>`;
      } else {
        const catMap = {};
        plans.forEach(p => {
          const icon = p.categoryIcon || '🎯';
          if (!catMap[icon]) catMap[icon] = 0;
          catMap[icon] += (p.currentSaved || 0);
        });

        catContainer.innerHTML = '';
        Object.keys(catMap).forEach(icon => {
          const amount = catMap[icon];
          const pct = totalSaved > 0 ? Math.round((amount / totalSaved) * 100) : 0;

          const item = document.createElement('div');
          item.style.marginBottom = '0.5rem';
          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.3rem;">
              <span style="font-weight: 600;">${icon} Category Allocation</span>
              <span style="font-weight: 700; color: var(--accent-primary);">${formatCurrency(amount)} (${pct}%)</span>
            </div>
            <div class="progress-track" style="height: 6px;"><div class="progress-fill" style="width: ${pct}%;"></div></div>
          `;
          catContainer.appendChild(item);
        });
      }
    }

    // Render Goal Progress Leaderboard
    const leadContainer = document.getElementById('analyticsLeaderboardContainer');
    if (leadContainer) {
      if (plans.length === 0) {
        leadContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No active savings goals found.</p>`;
      } else {
        const sortedPlans = [...plans].sort((a, b) => {
          const pctA = a.targetAmount > 0 ? (a.currentSaved / a.targetAmount) : 0;
          const pctB = b.targetAmount > 0 ? (b.currentSaved / b.targetAmount) : 0;
          return pctB - pctA;
        });

        leadContainer.innerHTML = '';
        sortedPlans.forEach((p, idx) => {
          const pct = p.targetAmount > 0 ? Math.min(100, Math.round((p.currentSaved / p.targetAmount) * 100)) : 0;
          const badgeColor = pct >= 100 ? 'var(--accent-amber)' : (idx === 0 ? 'var(--accent-primary)' : 'var(--accent-blue)');

          const card = document.createElement('div');
          card.style.background = 'rgba(255, 255, 255, 0.03)';
          card.style.border = '1px solid var(--border-color)';
          card.style.padding = '0.8rem 1rem';
          card.style.borderRadius = 'var(--radius-sm)';
          card.style.display = 'flex';
          card.style.alignItems = 'center';
          card.style.justifyContent = 'space-between';

          card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div style="font-weight: 800; font-size: 1rem; color: var(--text-muted);">#${idx + 1}</div>
              <div>
                <div style="font-weight: 700; font-size: 0.9rem;">${p.categoryIcon || '🎯'} ${p.title}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${formatCurrency(p.currentSaved)} / ${formatCurrency(p.targetAmount)}</div>
              </div>
            </div>
            <div style="font-weight: 800; font-size: 1.1rem; color: ${badgeColor};">${pct}%</div>
          `;
          leadContainer.appendChild(card);
        });
      }
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.mobile-nav-item').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      if (content.id === `tab-${tabName}`) {
        content.classList.remove('hidden');
        if (window.gsap) {
          gsap.fromTo(content, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
        }
      } else {
        content.classList.add('hidden');
      }
    });
  }

  // --------------------------------------------------------------------------
  // Firebase Auth & Firestore Real-Time Setup
  // --------------------------------------------------------------------------
  let firebaseAuth = null;
  let googleAuthProvider = null;
  let firebaseDb = null;

  function initFirebaseAuth() {
    if (window.FirebaseSDK) {
      try {
        const firebaseConfig = JSON.parse(localStorage.getItem('savenest_firebase_config')) || {
          apiKey: "AIzaSyA4QGocLJ3Ibk3s9qFaQLOQziuNkUOKlZQ",
          authDomain: "savenest-app-2026.firebaseapp.com",
          projectId: "savenest-app-2026",
          storageBucket: "savenest-app-2026.firebasestorage.app",
          messagingSenderId: "823368458610",
          appId: "1:823368458610:web:ef194027a84059b834bdeb"
        };

        const app = window.FirebaseSDK.initializeApp(firebaseConfig);
        firebaseAuth = window.FirebaseSDK.getAuth(app);
        firebaseDb = window.FirebaseSDK.getFirestore(app);
        googleAuthProvider = new window.FirebaseSDK.GoogleAuthProvider();

        // Listen to Auth State Changes
        window.FirebaseSDK.onAuthStateChanged(firebaseAuth, (firebaseUser) => {
          if (firebaseUser) {
            const user = {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
              avatar: 'G'
            };
            State.setCurrentUser(user);
            setupFirestoreRealtime();
            renderApp();
          }
        });
      } catch (err) {
        console.log('Firebase Auth initialization note:', err);
      }
    }
  }

  function setupFirestoreRealtime() {
    if (!firebaseDb || !window.FirebaseSDK) return;

    // 1. Real-Time Requests Sync across all accounts
    try {
      const requestsRef = window.FirebaseSDK.collection(firebaseDb, "requests");
      window.FirebaseSDK.onSnapshot(requestsRef, (snapshot) => {
        const liveRequests = [];
        snapshot.forEach((docSnap) => {
          liveRequests.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (liveRequests.length > 0) {
          State.requests = liveRequests;
          State.saveRequests();
          renderApp();
        }
      });
    } catch (e) {
      console.log('Firestore requests snapshot listener note:', e);
    }

    // 2. Real-Time Registered Users Sync across all devices
    try {
      const usersRef = window.FirebaseSDK.collection(firebaseDb, "users");
      window.FirebaseSDK.onSnapshot(usersRef, (snapshot) => {
        snapshot.forEach((docSnap) => {
          const u = docSnap.data();
          if (u && u.email) {
            const lower = u.email.toLowerCase();
            const existing = State.users.find(x => x.email.toLowerCase() === lower);
            if (!existing) {
              State.users.push({
                email: u.email,
                name: u.name || u.email.split('@')[0],
                avatar: (u.name || u.email).charAt(0).toUpperCase()
              });
              State.saveUsers();
            }
          }
        });
      });
    } catch (e) {
      console.log('Firestore users snapshot listener note:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Event Listeners Initialization
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // 0. Firebase Google Sign In Button Handler
    const googleBtn = document.getElementById('googleSignInBtn');
    if (googleBtn) {
      googleBtn.addEventListener('click', async () => {
        if (firebaseAuth && window.FirebaseSDK) {
          try {
            showToast('Opening Google Sign-In...');
            const result = await window.FirebaseSDK.signInWithPopup(firebaseAuth, googleAuthProvider);
            const user = {
              uid: result.user.uid,
              email: result.user.email,
              name: result.user.displayName || result.user.email.split('@')[0],
              avatar: 'G'
            };
            const googleEmail = result.user.email.toLowerCase();
            let existingUser = State.users.find(u => u.email.toLowerCase() === googleEmail);

            if (existingUser && existingUser.provider === 'email') {
              showToast('This email is registered using Email & Password. Please sign in with your email and password.', 'danger');
              return;
            }

            if (!existingUser) {
              existingUser = {
                email: result.user.email,
                name: result.user.displayName || result.user.email.split('@')[0],
                avatar: 'G',
                provider: 'google'
              };
              State.users.push(existingUser);
              State.saveUsers();
            } else {
              existingUser.provider = 'google';
              State.saveUsers();
            }

            State.setCurrentUser(existingUser);
            showToast(`Signed in with Google as ${existingUser.name}`);
            renderApp();
          } catch (err) {
            console.error('Google Sign In Error:', err);
            showToast(`Google Sign In failed: ${err.message}`, 'danger');
          }
        }
      });
    }

    // Mobile Bottom Navigation Bar Handler
    document.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = e.currentTarget.getAttribute('data-tab');
        switchTab(tabName);
      });
    });

    // 0. Auth Tab Mode Switcher (Sign In vs Create Account)
    let isSignUpMode = false;
    const tabSignIn = document.getElementById('authTabSignIn');
    const tabSignUp = document.getElementById('authTabSignUp');
    const nameGroup = document.getElementById('nameGroup');
    const submitBtn = document.getElementById('authSubmitBtn');

    if (tabSignIn && tabSignUp) {
      tabSignIn.addEventListener('click', () => {
        isSignUpMode = false;
        tabSignIn.style.background = 'rgba(16, 185, 129, 0.2)';
        tabSignIn.style.color = 'var(--accent-primary)';
        tabSignUp.style.background = 'transparent';
        tabSignUp.style.color = 'var(--text-muted)';
        nameGroup.style.display = 'none';
        submitBtn.textContent = 'Sign In';
      });

      tabSignUp.addEventListener('click', () => {
        isSignUpMode = true;
        tabSignUp.style.background = 'rgba(16, 185, 129, 0.2)';
        tabSignUp.style.color = 'var(--accent-primary)';
        tabSignIn.style.background = 'transparent';
        tabSignIn.style.color = 'var(--text-muted)';
        nameGroup.style.display = 'block';
        submitBtn.textContent = 'Create Account & Sign In';
      });
    }

    // 1. Auth Form Submit (Firebase Email Auth Integration)
    document.getElementById('signInForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value.trim();
      const nameInput = document.getElementById('authName').value.trim();

      if (!email || !password) {
        showToast('Please enter both email and password.', 'danger');
        return;
      }

      const emailLower = email.toLowerCase();
      let existingUser = State.users.find(u => u.email.toLowerCase() === emailLower);

      if (existingUser && existingUser.provider === 'google') {
        showToast('This email address is registered using Google Sign-In. Please click "Sign in with Google".', 'danger');
        return;
      }

      if (isSignUpMode) {
        if (existingUser) {
          showToast('An account already exists with this email address. Please switch to the "Sign In" tab.', 'danger');
          return;
        }

        if (firebaseAuth && window.FirebaseSDK) {
          try {
            showToast('Creating account with Firebase...');
            const userCred = await window.FirebaseSDK.createUserWithEmailAndPassword(firebaseAuth, email, password);
            const name = nameInput || email.split('@')[0];
            const user = {
              uid: userCred.user.uid,
              email: userCred.user.email,
              name: name,
              avatar: name.charAt(0).toUpperCase(),
              provider: 'email'
            };
            State.users.push(user);
            State.saveUsers();
            State.setCurrentUser(user);
            showToast(`Account created successfully! Welcome ${user.name}`);
            renderApp();
            return;
          } catch (err) {
            console.error('Firebase createUser error:', err);
            if (err.code === 'auth/email-already-in-use') {
              showToast('An account already exists with this email address. Please switch to "Sign In".', 'danger');
            } else if (err.code === 'auth/weak-password') {
              showToast('Password should be at least 6 characters long.', 'danger');
            } else {
              showToast(`Registration error: ${err.message}`, 'danger');
            }
            return;
          }
        }
      } else {
        if (firebaseAuth && window.FirebaseSDK) {
          try {
            showToast('Signing in with Firebase...');
            const userCred = await window.FirebaseSDK.signInWithEmailAndPassword(firebaseAuth, email, password);
            const name = nameInput || existingUser?.name || email.split('@')[0];
            const user = {
              uid: userCred.user.uid,
              email: userCred.user.email,
              name: name,
              avatar: name.charAt(0).toUpperCase(),
              provider: 'email'
            };
            if (!existingUser) {
              State.users.push(user);
              State.saveUsers();
            }
            State.setCurrentUser(user);
            showToast(`Signed in successfully as ${user.name}`);
            renderApp();
            return;
          } catch (err) {
            console.error('Firebase signIn error:', err);
            if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
              showToast('No account found with these credentials. Please check your email or click "Create Account".', 'danger');
            } else {
              showToast(`Sign in error: ${err.message}`, 'danger');
            }
            return;
          }
        }
      }
    });

    // Theme Manager (Dark Mode vs Light Mode)
    const themeDarkBtn = document.getElementById('themeDarkBtn');
    const themeLightBtn = document.getElementById('themeLightBtn');

    // Currency Selector Handler
    const currencySelect = document.getElementById('currencySelector');
    if (currencySelect) {
      currencySelect.value = localStorage.getItem('savenest_currency') || 'USD';
      currencySelect.addEventListener('change', (e) => {
        const newCurrency = e.target.value;
        localStorage.setItem('savenest_currency', newCurrency);
        showToast(`Currency updated to ${newCurrency}`);
        renderApp();
      });
    }

    function applyTheme(theme) {
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        if (themeLightBtn && themeDarkBtn) {
          themeLightBtn.style.borderColor = 'var(--accent-primary)';
          themeDarkBtn.style.borderColor = 'var(--border-color)';
        }
      } else {
        document.documentElement.removeAttribute('data-theme');
        if (themeLightBtn && themeDarkBtn) {
          themeDarkBtn.style.borderColor = 'var(--accent-primary)';
          themeLightBtn.style.borderColor = 'var(--border-color)';
        }
      }
      localStorage.setItem('savenest_theme', theme);
    }

    if (themeDarkBtn) themeDarkBtn.addEventListener('click', () => applyTheme('dark'));
    if (themeLightBtn) themeLightBtn.addEventListener('click', () => applyTheme('light'));

    const savedTheme = localStorage.getItem('savenest_theme') || 'dark';
    applyTheme(savedTheme);

    // 2. Sign Out
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', () => {
        State.clearCurrentUser();
        showToast('Signed out successfully');
        renderApp();
      });
    }

    // 2.5 Delete Account Handler
    function triggerDeleteModalFlow() {
      if (!State.currentUser) return;
      openModal('deleteAccountModal');
    }

    const openDeleteBtn = document.getElementById('openDeleteAccountBtn');
    if (openDeleteBtn) {
      openDeleteBtn.addEventListener('click', triggerDeleteModalFlow);
    }

    const settingsDeleteBtn = document.getElementById('settingsDeleteAccountBtn');
    if (settingsDeleteBtn) {
      settingsDeleteBtn.addEventListener('click', triggerDeleteModalFlow);
    }

    const confirmDeleteBtn = document.getElementById('confirmDeleteAccountBtn');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', async () => {
        if (!State.currentUser) return;
        const currentEmail = State.currentUser.email.toLowerCase();

        // Delete from Firebase Auth if active user is signed in
        if (firebaseAuth && firebaseAuth.currentUser) {
          try {
            await firebaseAuth.currentUser.delete();
          } catch (e) {
            console.log('Firebase user delete note:', e);
          }
        }

        // Delete from State & LocalStorage & Firestore
        State.deleteUserAccount(currentEmail);
        closeModal('deleteAccountModal');
        showToast('Your account and all associated data have been permanently deleted.', 'danger');
        renderApp();
      });
    }

    // 3. Navigation Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = e.currentTarget.getAttribute('data-tab');
        switchTab(tabName);
      });
    });

    // 4. Modal Open & Close Triggers
    const openNewPlanModalBtn = document.getElementById('openNewPlanModalBtn');
    if (openNewPlanModalBtn) {
      openNewPlanModalBtn.addEventListener('click', () => {
        openModal('createPlanModal');
      });
    }

    const openLogTxModalBtn = document.getElementById('openLogTxModalBtn');
    if (openLogTxModalBtn) {
      openLogTxModalBtn.addEventListener('click', () => {
        const plans = State.getUserPlans(State.currentUser ? State.currentUser.email : '');
        const select = document.getElementById('txPlanId');
        if (plans.length === 0) {
          showToast('Please create a savings plan first before logging transactions.', 'danger');
          return;
        }
        select.innerHTML = '';
        plans.forEach(p => {
          select.innerHTML += `<option value="${p.id}">${p.categoryIcon || '🎯'} ${p.title} (Current: ${formatCurrency(p.currentSaved)})</option>`;
        });
        openModal('logTxModal');
      });
    }

    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = e.currentTarget.getAttribute('data-close');
        closeModal(modalId);
      });
    });

    // 5. Create Plan Form
    const createPlanForm = document.getElementById('createPlanForm');
    if (createPlanForm) {
      createPlanForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('planTitle').value.trim();
        const reason = document.getElementById('planReason').value.trim();
        const targetAmount = parseFloat(document.getElementById('planTarget').value);
        const initialSaved = parseFloat(document.getElementById('planInitial').value) || 0;
        const categoryIcon = document.getElementById('planIcon').value;

        if (isNaN(targetAmount) || targetAmount <= 0) {
          showToast('Please enter a valid target goal amount greater than $0.', 'danger');
          return;
        }
        if (isNaN(initialSaved) || initialSaved < 0) {
          showToast('Initial saved balance cannot be negative.', 'danger');
          return;
        }

        const planId = 'plan_' + Date.now();

        const newPlan = {
          id: planId,
          title,
          reason,
          targetAmount,
          currentSaved: initialSaved,
          categoryIcon,
          createdAt: new Date().toISOString()
        };

        State.addPlan(newPlan);

        // If initial saved money > 0, log it in transaction history
        if (initialSaved > 0) {
          State.addTransaction({
            id: 'tx_' + Date.now(),
            planId: planId,
            type: 'deposit',
            amount: initialSaved,
            note: 'Initial saved balance upon creation',
            date: new Date().toISOString()
          });
        }

        showToast(`Created savings plan "${title}"!`);
        closeModal('createPlanModal');
        createPlanForm.reset();
        renderApp();
      });
    }

    // 6. Log Transaction Form
    const logTxForm = document.getElementById('logTxForm');
    if (logTxForm) {
      logTxForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const planId = document.getElementById('txPlanId').value;
        const type = document.getElementById('txType').value;
        const amount = parseFloat(document.getElementById('txAmount').value);
        const note = document.getElementById('txNote').value.trim();

        if (isNaN(amount) || amount <= 0) {
          showToast('Please enter a valid transaction amount greater than $0.', 'danger');
          return;
        }

        State.addTransaction({
          id: 'tx_' + Date.now(),
          planId,
          type,
          amount,
          note,
          date: new Date().toISOString()
        });

        showToast(`Recorded ${type} of ${formatCurrency(amount)}`);
        closeModal('logTxModal');
        logTxForm.reset();
        renderApp();
      });
    }

    // 7. Request Money Form
    const requestMoneyForm = document.getElementById('requestMoneyForm');
    if (requestMoneyForm) {
      requestMoneyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const recipientEmail = document.getElementById('reqRecipientEmail').value.trim();
        const amount = parseFloat(document.getElementById('reqAmount').value);
        const reason = document.getElementById('reqReason').value.trim();
        const linkedPlanId = document.getElementById('reqLinkPlan').value;

        if (isNaN(amount) || amount <= 0) {
          showToast('Please enter a valid request amount greater than $0.', 'danger');
          return;
        }

        const recipientLower = recipientEmail.toLowerCase().trim();

        if (State.currentUser && recipientLower === State.currentUser.email.toLowerCase()) {
          showToast('You cannot send a payment request to your own account email.', 'danger');
          return;
        }

        // RULE: Target recipient MUST be a registered user on SaveNest (check local & Cloud Firestore)
        let isRegistered = State.users.some(u => u.email.toLowerCase() === recipientLower);

        if (!isRegistered && firebaseDb && window.FirebaseSDK) {
          try {
            const userDoc = await window.FirebaseSDK.getDoc(window.FirebaseSDK.doc(firebaseDb, "users", recipientLower));
            if (userDoc && userDoc.exists()) {
              isRegistered = true;
              const uData = userDoc.data();
              State.users.push({ email: uData.email, name: uData.name || recipientLower.split('@')[0] });
              State.saveUsers();
            }
          } catch (e) {
            console.log('Firestore user check note:', e);
          }
        }

        if (!isRegistered) {
          showToast(`Cannot send request. No registered user account found for "${recipientEmail}". They must register an account on SaveNest first.`, 'danger');
          return;
        }

        // Add to recent recipients list
        addRecentRecipient(recipientLower);

        const newRequest = {
          id: 'req_' + Date.now(),
          requesterEmail: State.currentUser ? State.currentUser.email : '',
          recipientEmail: recipientEmail,
          amount,
          reason,
          linkedPlanId,
          status: 'pending',
          recipientMessage: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        State.addRequest(newRequest);
        showToast(`Payment request for ${formatCurrency(amount)} sent to ${recipientEmail}!`);
        requestMoneyForm.reset();
        
        switchTab('inbox');
        renderApp();
      });
    }

    // 9. Respond Accept / Decline buttons
    const acceptRequestBtn = document.getElementById('acceptRequestBtn');
    if (acceptRequestBtn) {
      acceptRequestBtn.addEventListener('click', () => {
        const reqId = document.getElementById('replyRequestId').value;
        const message = document.getElementById('replyMessage').value.trim() || 'Accepted';
        State.updateRequestStatus(reqId, 'accepted', message);
        showToast('Accepted payment request!');
        closeModal('replyRequestModal');
        renderApp();
      });
    }

    const declineRequestBtn = document.getElementById('declineRequestBtn');
    if (declineRequestBtn) {
      declineRequestBtn.addEventListener('click', () => {
        const reqId = document.getElementById('replyRequestId').value;
        const message = document.getElementById('replyMessage').value.trim() || 'Declined';
        State.updateRequestStatus(reqId, 'declined', message);
        showToast('Declined request.');
        closeModal('replyRequestModal');
        renderApp();
      });
    }
  }

  // --------------------------------------------------------------------------
  // GSAP Animated Splash Screen Controller (~3-Second Realistic Loading)
  // --------------------------------------------------------------------------
  let splashInitialized = false;

  function initSplashScreen() {
    if (splashInitialized) return;
    const splashEl = document.getElementById('splashScreen');
    const statusEl = document.getElementById('splashStatusText');
    if (!splashEl) return;
    splashInitialized = true;

    function hideSplash() {
      if (!splashEl) return;
      splashEl.classList.add('hidden');
      splashEl.style.display = 'none';
      splashEl.style.pointerEvents = 'none';
    }

    // Unconditional safety fallback timer (3.2 seconds max)
    setTimeout(hideSplash, 3200);

    if (window.gsap) {
      try {
        const tl = gsap.timeline();

        // Entrance Animations (0.7s)
        tl.from('#splashIcon', { scale: 0, opacity: 0, rotation: -15, duration: 0.7, ease: 'back.out(1.8)' })
          .from('#splashTitle', { y: 20, opacity: 0, duration: 0.4, ease: 'power2.out' }, '-=0.3')
          .from('#splashSubtitle', { y: 15, opacity: 0, duration: 0.35, ease: 'power2.out' }, '-=0.2')
          
          // Stage 1 Loading: Engine Initialization
          .to('#splashProgressBar', { width: '40%', duration: 0.85, ease: 'power1.out', onComplete: () => {
              if (statusEl) statusEl.textContent = 'Syncing Cloud Vault...';
          }})
          // Stage 2 Loading: Syncing Cloud Vault
          .to('#splashProgressBar', { width: '80%', duration: 0.95, ease: 'power2.inOut', onComplete: () => {
              if (statusEl) statusEl.textContent = 'Preparing Workspace...';
          }})
          // Stage 3 Loading: Complete
          .to('#splashProgressBar', { width: '100%', duration: 0.5, ease: 'power1.in', onComplete: () => {
              if (statusEl) statusEl.textContent = 'Ready!';
          }})
          
          // Fade Out & Scale Entrance to Main App (0.5s)
          .to(splashEl, { opacity: 0, scale: 1.05, duration: 0.5, ease: 'power2.inOut', onComplete: hideSplash }, '+=0.2');
      } catch (e) {
        console.error('GSAP splash animation error:', e);
        setTimeout(hideSplash, 1500);
      }
    } else {
      setTimeout(hideSplash, 2500);
    }
  }

  // --------------------------------------------------------------------------
  // App Bootstrapper
  // --------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initSplashScreen();
    State.init();
    initFirebaseAuth();
    setupEventListeners();
    renderApp();
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initSplashScreen, 10);
  }

})();
