document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const authOverlay = document.getElementById('auth-overlay');
    const authInput = document.getElementById('admin-key-input');
    const authBtn = document.getElementById('auth-btn');
    const authError = document.getElementById('auth-error');
    const appLayout = document.getElementById('app');
    const logoutBtn = document.getElementById('logout-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const pageTitle = document.getElementById('page-title');
    const toastEl = document.getElementById('toast');
    
    // Modal Elements
    const confirmModal = document.getElementById('confirm-modal');
    const confirmTitle = document.getElementById('confirm-title');
    const confirmMsg = document.getElementById('confirm-message');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    let pendingConfirmAction = null;

    const userModal = document.getElementById('user-modal');
    const userModalClose = document.getElementById('user-modal-close');
    const userModalInfo = document.getElementById('user-modal-info');
    const userModalTxs = document.getElementById('user-modal-txs');

    let adminKey = localStorage.getItem('zapp_admin_key');

    // Init
    if (adminKey) {
        verifyAndLoad();
    } else {
        authInput.focus();
    }

    // Auth Handlers
    authBtn.addEventListener('click', handleAuth);
    authInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAuth();
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('zapp_admin_key');
        adminKey = null;
        appLayout.classList.add('hidden');
        authOverlay.classList.remove('hidden');
        authInput.value = '';
        authInput.focus();
    });

    refreshBtn.addEventListener('click', () => {
        loadActiveTab();
        showToast('Data refreshed');
    });

    // Navigation Handlers
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            
            // Update nav state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Update title
            pageTitle.textContent = item.textContent.trim();
            
            // Show corresponding tab
            tabPanes.forEach(pane => pane.classList.remove('active'));
            const targetPane = document.getElementById(`tab-${tabId}`);
            if(targetPane) targetPane.classList.add('active');

            // Load data
            loadActiveTab();
        });
    });

    // Modal Handlers
    confirmCancelBtn.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        if (pendingConfirmAction) pendingConfirmAction = null;
    });

    confirmActionBtn.addEventListener('click', async () => {
        if (pendingConfirmAction) {
            confirmModal.classList.add('hidden');
            await pendingConfirmAction();
            pendingConfirmAction = null;
        }
    });

    function showConfirm(title, message, isDanger, onConfirm) {
        confirmTitle.textContent = title;
        confirmMsg.textContent = message;
        
        // Style the action button based on danger level
        confirmActionBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
        
        pendingConfirmAction = onConfirm;
        confirmModal.classList.remove('hidden');
    }

    userModalClose.addEventListener('click', () => {
        userModal.classList.add('hidden');
    });

    async function handleAuth() {
        const key = authInput.value.trim();
        if (!key) return;
        
        authBtn.textContent = 'Verifying...';
        authBtn.disabled = true;
        
        try {
            const res = await fetch('/admin/stats', {
                headers: { 'x-admin-key': key }
            });
            
            if (res.ok) {
                adminKey = key;
                localStorage.setItem('zapp_admin_key', key);
                authOverlay.classList.add('hidden');
                appLayout.classList.remove('hidden');
                authError.classList.add('hidden');
                loadOverviewData(await res.json());
            } else {
                throw new Error('Unauthorized');
            }
        } catch(err) {
            authError.classList.remove('hidden');
        } finally {
            authBtn.textContent = 'Authenticate';
            authBtn.disabled = false;
        }
    }

    async function verifyAndLoad() {
        try {
            const res = await fetch('/admin/stats', {
                headers: { 'x-admin-key': adminKey }
            });
            
            if (res.ok) {
                authOverlay.classList.add('hidden');
                appLayout.classList.remove('hidden');
                loadActiveTab();
            } else {
                localStorage.removeItem('zapp_admin_key');
            }
        } catch(err) {
            console.error('Connection error', err);
        }
    }

    function loadActiveTab() {
        const activeTab = document.querySelector('.nav-item.active').getAttribute('data-tab');
        if (activeTab === 'overview') fetchOverview();
        else if (activeTab === 'users') fetchUsers();
        else if (activeTab === 'transactions') fetchTransactions();
        else if (activeTab === 'circles') fetchCircles();
    }

    // --- Data Fetchers ---

    async function fetchOverview() {
        renderSkeletons('stats-grid', 4);
        try {
            const res = await apiCall('/admin/stats');
            if(res) loadOverviewData(res);
        } catch(e) {}
    }

    async function fetchUsers() {
        try {
            const res = await apiCall('/admin/users');
            if (res && res.users) {
                const tbody = document.getElementById('users-table-body');
                tbody.innerHTML = '';
                if(res.users.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No users found.</td></tr>';
                    return;
                }
                
                res.users.forEach(user => {
                    const tr = document.createElement('tr');
                    const verifiedBadge = user.self_verified 
                        ? '<span class="badge success">Verified</span>' 
                        : '<span class="badge neutral">Unverified</span>';
                    const flaggedBadge = user.flagged 
                        ? '<span class="badge danger" style="margin-left:8px;">Flagged</span>' 
                        : '';
                    
                    const verifyBtn = !user.self_verified 
                        ? `<button class="btn btn-sm btn-outline verify-btn" data-id="${user.telegram_id}">Manually Verify</button>`
                        : '';
                    const flagBtn = !user.flagged
                        ? `<button class="btn btn-sm btn-outline flag-btn" data-id="${user.telegram_id}" style="margin-left:8px; color: var(--danger); border-color: var(--danger);">Flag</button>`
                        : '';
                    const deleteBtn = `<button class="btn btn-sm btn-danger delete-btn" data-id="${user.telegram_id}" style="margin-left:8px;">Delete</button>`;

                    tr.innerHTML = `
                        <td class="code-mono pointer-cell">${user.telegram_id}</td>
                        <td class="pointer-cell">${user.telegram_username ? '@'+user.telegram_username : '-'}</td>
                        <td class="pointer-cell">${user.telegram_name || '-'}</td>
                        <td class="code-mono pointer-cell" title="${user.wallet_address || ''}">${truncateWallet(user.wallet_address)}</td>
                        <td class="pointer-cell">${verifiedBadge}${flaggedBadge}</td>
                        <td class="actions-cell">${verifyBtn}${flagBtn}${deleteBtn}</td>
                    `;
                    
                    // Click row to view details
                    tr.style.cursor = 'pointer';
                    Array.from(tr.children).forEach(td => {
                        if (!td.classList.contains('actions-cell')) {
                            td.addEventListener('click', () => showUserDetails(user));
                        }
                    });

                    tbody.appendChild(tr);
                });

                // Attach Action Listeners
                document.querySelectorAll('.verify-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const id = e.target.getAttribute('data-id');
                        showConfirm('Verify User', `Are you sure you want to manually verify user ${id}?`, false, async () => {
                            e.target.disabled = true;
                            e.target.textContent = 'Verifying...';
                            const res = await apiCall(`/admin/verify/${id}`, 'POST');
                            if(res) {
                                showToast('User verified successfully');
                                fetchUsers();
                            } else {
                                e.target.disabled = false;
                                e.target.textContent = 'Manually Verify';
                            }
                        });
                    });
                });

                document.querySelectorAll('.flag-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const id = e.target.getAttribute('data-id');
                        showConfirm('Flag User', `Are you sure you want to flag user ${id}?`, true, async () => {
                            e.target.disabled = true;
                            e.target.textContent = 'Flagging...';
                            const res = await apiCall(`/admin/users/${id}/flag`, 'POST');
                            if(res) {
                                showToast('User flagged successfully');
                                fetchUsers();
                            } else {
                                e.target.disabled = false;
                                e.target.textContent = 'Flag';
                            }
                        });
                    });
                });

                document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const id = e.target.getAttribute('data-id');
                        showConfirm('Delete User', `Are you sure you want to permanently delete user ${id}? This action cannot be undone.`, true, async () => {
                            e.target.disabled = true;
                            e.target.textContent = 'Deleting...';
                            const res = await apiCall(`/admin/users/${id}`, 'DELETE');
                            if(res) {
                                showToast('User deleted successfully');
                                fetchUsers();
                            } else {
                                e.target.disabled = false;
                                e.target.textContent = 'Delete';
                            }
                        });
                    });
                });
            }
        } catch(e) {}
    }

    async function fetchTransactions() {
        try {
            const res = await apiCall('/admin/transactions?period=all');
            if (res && res.transactions) {
                const tbody = document.getElementById('tx-table-body');
                tbody.innerHTML = '';
                if(res.transactions.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No transactions found.</td></tr>';
                    return;
                }
                
                res.transactions.forEach(tx => {
                    const tr = document.createElement('tr');
                    const statusClass = tx.status === 'confirmed' ? 'success' : (tx.status === 'failed' ? 'danger' : 'neutral');
                    tr.innerHTML = `
                        <td class="code-mono"><a href="https://celo-sepolia.blockscout.com/tx/${tx.tx_hash}" target="_blank" style="color:var(--accent);text-decoration:none;">${tx.tx_hash.substring(0,10)}...</a></td>
                        <td>${tx.tx_type}</td>
                        <td class="code-mono" title="${tx.from_address || ''}">${truncateWallet(tx.from_address)}</td>
                        <td class="code-mono" title="${tx.to_address || ''}">${truncateWallet(tx.to_address)}</td>
                        <td style="font-weight:600;">${tx.amount_cusd}</td>
                        <td><span class="badge ${statusClass}">${tx.status}</span></td>
                        <td style="color:var(--text-muted); font-size:12px;">${new Date(tx.created_at).toLocaleString()}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } catch(e) {}
    }

    async function fetchCircles() {
        try {
            const res = await apiCall('/admin/circles');
            if (res) {
                const tbody = document.getElementById('circles-table-body');
                tbody.innerHTML = '';
                if(res.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No circles found.</td></tr>';
                    return;
                }
                
                res.forEach(c => {
                    const tr = document.createElement('tr');
                    const statusClass = c.status === 'active' ? 'success' : 'neutral';
                    tr.innerHTML = `
                        <td style="font-weight:600;">${c.name}</td>
                        <td class="code-mono">${c.admin_user_id}</td>
                        <td>${c.contribution_cusd}</td>
                        <td>${c.interval_days}</td>
                        <td>${c.max_members}</td>
                        <td><span class="badge ${statusClass}">${c.status}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } catch(e) {}
    }

    // --- Helpers ---

    async function apiCall(endpoint, method = 'GET', body = null) {
        if (!adminKey) return null;
        try {
            const opts = {
                method,
                headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' }
            };
            if(body) opts.body = JSON.stringify(body);
            
            const res = await fetch('/api' + (endpoint.startsWith('/admin') ? endpoint.replace('/admin', '/admin') : endpoint), opts);
            // Quick hack for /admin/stats which is mounted on root app in server.js vs /api/admin
            const url = endpoint.startsWith('/admin/stats') ? endpoint : `/api${endpoint}`;
            const actualRes = await fetch(url, opts);

            if (actualRes.status === 401) {
                localStorage.removeItem('zapp_admin_key');
                window.location.reload();
                return null;
            }
            if(!actualRes.ok) {
                const data = await actualRes.json();
                showToast(data.error || 'Request failed', true);
                return null;
            }
            return await actualRes.json();
        } catch(err) {
            console.error('API Error:', err);
            showToast('Network error', true);
            return null;
        }
    }

    function loadOverviewData(data) {
        const grid = document.getElementById('stats-grid');
        grid.innerHTML = `
            <div class="stat-card">
                <div class="stat-title">Total Users</div>
                <div class="stat-value">${data.users?.total || 0}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:8px;">${data.users?.verified || 0} verified</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">Transactions (Vol)</div>
                <div class="stat-value">$${parseFloat(data.transactions?.volume_cusd || 0).toFixed(2)}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:8px;">${data.transactions?.today || 0} today</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">Total Txns</div>
                <div class="stat-value">${data.transactions?.total || 0}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:8px;">${data.transactions?.failed || 0} failed</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">Active Circles</div>
                <div class="stat-value">${data.circles?.active || 0}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:8px;">${data.circles?.total || 0} total</div>
            </div>
        `;

        if (data.recent_transactions) {
            const tbody = document.getElementById('overview-tx-body');
            tbody.innerHTML = '';
            if (data.recent_transactions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No recent transactions.</td></tr>';
            } else {
                data.recent_transactions.forEach(tx => {
                    const tr = document.createElement('tr');
                    const statusClass = tx.status === 'confirmed' ? 'success' : (tx.status === 'failed' ? 'danger' : 'neutral');
                    tr.innerHTML = `
                        <td class="code-mono"><a href="https://celo-sepolia.blockscout.com/tx/${tx.tx_hash}" target="_blank" style="color:var(--accent);text-decoration:none;">${tx.tx_hash.substring(0,10)}...</a></td>
                        <td>${tx.tx_type}</td>
                        <td class="code-mono">${tx.from_username ? '@'+tx.from_username : truncateWallet(tx.from_address)}</td>
                        <td class="code-mono">${tx.to_username ? '@'+tx.to_username : truncateWallet(tx.to_address)}</td>
                        <td style="font-weight:600;">${tx.amount_cusd}</td>
                        <td><span class="badge ${statusClass}">${tx.status}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }
    }

    async function showUserDetails(user) {
        userModal.classList.remove('hidden');
        userModalInfo.innerHTML = `
            <div><strong>ID:</strong> <span class="code-mono">${user.telegram_id}</span></div>
            <div><strong>Username:</strong> ${user.telegram_username ? '@'+user.telegram_username : '-'}</div>
            <div><strong>Name:</strong> ${user.telegram_name || '-'}</div>
            <div><strong>Status:</strong> ${user.self_verified ? '<span style="color:var(--accent);">Verified</span>' : 'Unverified'} ${user.flagged ? '<span style="color:var(--danger);">(Flagged)</span>' : ''}</div>
            <div style="grid-column: span 2;"><strong>Wallet:</strong> <span class="code-mono" style="font-size:12px;">${user.wallet_address || 'Not created'}</span></div>
        `;
        
        userModalTxs.innerHTML = `<tr><td colspan="4" class="text-center py-4">Loading transactions...</td></tr>`;
        
        const res = await apiCall(`/admin/users/${user.telegram_id}/transactions`);
        if (res && res.transactions) {
            userModalTxs.innerHTML = '';
            if(res.transactions.length === 0) {
                userModalTxs.innerHTML = '<tr><td colspan="4" class="text-center py-4">No transactions found.</td></tr>';
                return;
            }
            res.transactions.forEach(tx => {
                const tr = document.createElement('tr');
                const statusClass = tx.status === 'confirmed' ? 'success' : (tx.status === 'failed' ? 'danger' : 'neutral');
                tr.innerHTML = `
                    <td class="code-mono"><a href="https://celo-sepolia.blockscout.com/tx/${tx.tx_hash}" target="_blank" style="color:var(--accent);text-decoration:none;">${tx.tx_hash.substring(0,8)}...</a></td>
                    <td>${tx.tx_type}</td>
                    <td style="font-weight:600;">${tx.amount_cusd}</td>
                    <td><span class="badge ${statusClass}">${tx.status}</span></td>
                `;
                userModalTxs.appendChild(tr);
            });
        }
    }

    function renderSkeletons(containerId, count) {
        const c = document.getElementById(containerId);
        c.innerHTML = Array(count).fill('<div class="stat-card skeleton"></div>').join('');
    }

    function truncateWallet(address) {
        if(!address) return '-';
        return address.substring(0,6) + '...' + address.substring(address.length - 4);
    }

    let toastTimeout;
    function showToast(msg, isError = false) {
        toastEl.textContent = msg;
        toastEl.style.backgroundColor = isError ? 'var(--danger)' : 'var(--accent)';
        toastEl.style.color = isError ? '#fff' : '#000';
        toastEl.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('show');
        }, 3000);
    }
});
