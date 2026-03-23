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

    const circleModal = document.getElementById('circle-modal');
    const circleModalClose = document.getElementById('circle-modal-close');
    const circleModalInfo = document.getElementById('circle-modal-info');
    const circleModalMembers = document.getElementById('circle-modal-members');

    let adminKey = localStorage.getItem('zapp_admin_key');

    // Pagination State
    let overviewTxPage = 1;
    let txPage = 1;
    let usersPage = 1;
    let circlesPage = 1;

    const parseSqlDate = (dateStr) => {
        if (!dateStr || dateStr === '-') return null;
        try {
            return new Date(dateStr.replace(' ', 'T') + 'Z');
        } catch(e) { return null; }
    };

    // Overview Pagination Elements
    const overviewPrevBtn = document.getElementById('overview-tx-prev');
    const overviewNextBtn = document.getElementById('overview-tx-next');
    const overviewPageInfo = document.getElementById('overview-tx-page-info');

    // Transactions Pagination Elements
    const txPrevBtn = document.getElementById('tx-prev');
    const txNextBtn = document.getElementById('tx-next');
    const txPageInfo = document.getElementById('tx-page-info');

    // Users Pagination Elements
    const usersPrevBtn = document.getElementById('users-prev');
    const usersNextBtn = document.getElementById('users-next');
    const usersPageInfo = document.getElementById('users-page-info');

    // Circles Pagination Elements
    const circlesPrevBtn = document.getElementById('circles-prev');
    const circlesNextBtn = document.getElementById('circles-next');
    const circlesPageInfo = document.getElementById('circles-page-info');
    const txPeriodFilter = document.getElementById('tx-period-filter');
    const txStatusFilter = document.getElementById('tx-status-filter');

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
            const tabId = e.target.getAttribute('data-tab');
            pageTitle.textContent = e.target.textContent;
            
            navItems.forEach(nav => nav.classList.remove('active'));
            e.target.classList.add('active');
            
            tabPanes.forEach(pane => pane.classList.remove('active'));
            document.getElementById('tab-' + tabId).classList.add('active');
            
            if (tabId === 'overview') overviewTxPage = 1;
            if (tabId === 'transactions') txPage = 1;
            if (tabId === 'users') usersPage = 1;
            if (tabId === 'circles') circlesPage = 1;
            loadActiveTab();
        });
    });

    // Pagination Handlers
    if(overviewPrevBtn) overviewPrevBtn.addEventListener('click', () => { if(overviewTxPage > 1) { overviewTxPage--; fetchOverview(); } });
    if(overviewNextBtn) overviewNextBtn.addEventListener('click', () => { overviewTxPage++; fetchOverview(); });

    if(txPrevBtn) txPrevBtn.addEventListener('click', () => { if(txPage > 1) { txPage--; fetchTransactions(); } });
    if(txNextBtn) txNextBtn.addEventListener('click', () => { txPage++; fetchTransactions(); });

    if(usersPrevBtn) usersPrevBtn.addEventListener('click', () => { if(usersPage > 1) { usersPage--; fetchUsers(); } });
    if(usersNextBtn) usersNextBtn.addEventListener('click', () => { usersPage++; fetchUsers(); });

    if(circlesPrevBtn) circlesPrevBtn.addEventListener('click', () => { if(circlesPage > 1) { circlesPage--; fetchCircles(); } });
    if(circlesNextBtn) circlesNextBtn.addEventListener('click', () => { circlesPage++; fetchCircles(); });

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

    circleModalClose?.addEventListener('click', () => {
        circleModal.classList.add('hidden');
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
            const res = await apiCall(`/admin/stats?page=${overviewTxPage}`);
            if(res) loadOverviewData(res);
        } catch(e) {}
    }

    async function fetchUsers() {
        try {
            const limit = 50;
            const res = await apiCall(`/admin/users?page=${usersPage}&limit=${limit}`);
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

                // Update Pagination Controls
                const totalPages = Math.ceil((res.total || res.count) / limit) || 1;
                if (usersPageInfo) usersPageInfo.textContent = `Page ${usersPage} of ${totalPages}`;
                if (usersPrevBtn) usersPrevBtn.disabled = usersPage <= 1;
                if (usersNextBtn) usersNextBtn.disabled = usersPage >= totalPages;
            }
        } catch(e) {}
    }

    async function fetchTransactions() {
        try {
            const period = txPeriodFilter?.value || 'all';
            const status = txStatusFilter?.value || '';
            let url = `/admin/transactions?period=${period}&page=${txPage}`;
            if (status) url += `&status=${status}`;

            const res = await apiCall(url);
            if (res && res.transactions) {
                const tbody = document.getElementById('tx-table-body');
                tbody.innerHTML = '';
                if(res.transactions.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No transactions found.</td></tr>';
                } else {
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
                            <td style="color:var(--text-muted); font-size:12px;">${parseSqlDate(tx.created_at)?.toLocaleString() || '-'}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
                
                // Update Pagination Controls
                const totalPages = Math.ceil((res.total || res.count) / 50) || 1;
                if (txPageInfo) txPageInfo.textContent = `Page ${txPage} of ${totalPages}`;
                if (txPrevBtn) txPrevBtn.disabled = txPage <= 1;
                if (txNextBtn) txNextBtn.disabled = txPage >= totalPages;
            }
        } catch(e) {}
    }

    async function fetchCircles() {
        try {
            const limit = 50;
            const res = await apiCall(`/admin/circles?page=${circlesPage}&limit=${limit}`);
            if (res && res.circles) {
                const tbody = document.getElementById('circles-table-body');
                tbody.innerHTML = '';
                if(res.circles.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4">No circles found.</td></tr>';
                    return;
                }
                
                res.circles.forEach(c => {
                    const tr = document.createElement('tr');
                    const statusClass = c.status === 'active' ? 'success' : 'neutral';
                    tr.innerHTML = `
                        <td class="code-mono">${c.id}</td>
                        <td style="font-weight:600;">${c.name}</td>
                        <td class="code-mono">${c.admin_username ? '@'+c.admin_username : (c.admin_name || c.admin_user_id)}</td>
                        <td>${c.contribution_cusd}</td>
                        <td>${c.interval_days}</td>
                        <td>${c.max_members}</td>
                        <td><span class="badge ${statusClass}">${c.status}</span></td>
                        <td style="color:var(--text-muted); font-size:12px;">${c.end_date ? parseSqlDate(c.end_date)?.toLocaleDateString() : '-'}</td>
                    `;
                    
                    tr.style.cursor = 'pointer';
                    tr.addEventListener('click', () => showCircleDetails(c.id));
                    
                    tbody.appendChild(tr);
                });

                // Update Pagination Controls
                const totalPages = Math.ceil((res.total || res.count) / limit) || 1;
                if (circlesPageInfo) circlesPageInfo.textContent = `Page ${circlesPage} of ${totalPages}`;
                if (circlesPrevBtn) circlesPrevBtn.disabled = circlesPage <= 1;
                if (circlesNextBtn) circlesNextBtn.disabled = circlesPage >= totalPages;
            }
        } catch(e) {}
    }

    async function showCircleDetails(circleId) {
        circleModalInfo.innerHTML = 'Loading circle details...';
        circleModalMembers.innerHTML = '';
        circleModal.classList.remove('hidden');

        try {
            const data = await apiCall(`/admin/circles/${circleId}`);
            if(!data) {
                circleModalInfo.innerHTML = '<div style="color:var(--danger)">Failed to load circle data</div>';
                return;
            }

            const { circle, members } = data;
            
            document.getElementById('circle-modal-title').textContent = circle.name + ` (Round ${circle.current_round})`;

            circleModalInfo.innerHTML = `
                <div><strong>Admin ID:</strong> <span class="code-mono">${circle.admin_user_id}</span></div>
                <div><strong>Contribution:</strong> <span style="font-weight:600;">$${circle.contribution_cusd.toFixed(2)}</span> / ${circle.interval_days} days</div>
                <div><strong>Status:</strong> <span class="badge ${circle.status === 'active' ? 'success' : 'neutral'}">${circle.status}</span></div>
                <div><strong>Members:</strong> ${members.length} / ${circle.max_members}</div>
                <div><strong>Created:</strong> ${parseSqlDate(circle.created_at)?.toLocaleDateString() || '-'}</div>
                <div><strong>End Date:</strong> ${circle.end_date ? parseSqlDate(circle.end_date)?.toLocaleDateString() : '-'}</div>
                
                <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
                    <div style="display:flex; gap:8px; align-items:center;">
                        <strong>Action:</strong>
                        ${circle.status === 'active' ? `
                            <button class="btn btn-outline" style="border-color:var(--danger); color:var(--danger); padding:4px 8px; font-size:12px;" onclick="window.updateCircleStatus(${circle.id}, 'suspended')">Suspend Circle</button>
                        ` : ''}
                        ${circle.status === 'suspended' ? `
                            <button class="btn btn-outline" style="border-color:var(--success); color:var(--success); padding:4px 8px; font-size:12px;" onclick="window.updateCircleStatus(${circle.id}, 'active')">Reactivate Circle</button>
                        ` : ''}
                    </div>
                </div>
            `;

            if(members.length === 0) {
                circleModalMembers.innerHTML = '<tr><td colspan="4" class="text-center py-4">No participants yet</td></tr>';
            } else {
                members.forEach(m => {
                    const tr = document.createElement('tr');
                    
                    let paidBadge = m.has_paid_current_round 
                        ? `<span class="badge success" title="${m.current_payment?.amount_cusd} USDC">Paid</span>`
                        : `<span class="badge danger">Pending</span>`;
                        
                    let claimedBadge = m.has_claimed
                        ? `<span class="badge success" title="Round ${m.claimed_payout?.round_number}">Yes (R${m.claimed_payout?.round_number})</span>`
                        : `<span class="badge neutral">No</span>`;

                    tr.innerHTML = `
                        <td class="code-mono">${m.telegram_username ? '@'+m.telegram_username : m.telegram_name || m.telegram_id}</td>
                        <td class="code-mono" title="${m.wallet_address || ''}">${truncateWallet(m.wallet_address)}</td>
                        <td>${paidBadge}</td>
                        <td>${claimedBadge}</td>
                    `;
                    circleModalMembers.appendChild(tr);
                });
            }
        } catch(e) {
            console.error('Error fetching circle details:', e);
            circleModalInfo.innerHTML = '<div style="color:var(--danger)">Error loading data</div>';
        }
    }

    // --- Helpers ---

    window.updateCircleStatus = async (circleId, status) => {
        showConfirm(
            status === 'suspended' ? 'Suspend Circle' : 'Reactivate Circle',
            `Are you sure you want to change circle ${circleId} status to ${status}?`,
            status === 'suspended',
            async () => {
                try {
                    const res = await apiCall(`/admin/circles/${circleId}/status`, 'PUT', { status });
                    if (res && res.success) {
                        showToast(`Circle ${status} successfully`);
                        // Refresh both the modal and the underlaying table
                        showCircleDetails(circleId);
                        fetchCircles();
                    } else {
                        showToast(res?.error || 'Failed to update circle', true);
                    }
                } catch(e) {
                    showToast('Connection error', true);
                }
            }
        );
    };

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
                tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No recent transactions.</td></tr>';
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
                        <td style="color:var(--text-muted); font-size:12px;">${parseSqlDate(tx.created_at)?.toLocaleString() || '-'}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
            // Update Pagination Controls
            const totalPages = Math.ceil((data.recent_transactions_total || 0) / 5) || 1;
            if (overviewPageInfo) overviewPageInfo.textContent = `Page ${overviewTxPage} of ${totalPages}`;
            if (overviewPrevBtn) overviewPrevBtn.disabled = overviewTxPage <= 1;
            if (overviewNextBtn) overviewNextBtn.disabled = overviewTxPage >= totalPages;
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
