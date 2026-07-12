(function(){
  let me = null;
  let activeStudentId = null;

  async function api(url, opts={}){
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      if(res.status === 401){ window.location.href = '/login.html'; return; }
      throw new Error(data.error || 'Something went wrong.');
    }
    return data;
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }
  function gradeFor(score){
    if(score >= 80) return 'A';
    if(score >= 65) return 'B';
    if(score >= 50) return 'C';
    return 'F';
  }

  async function init(){
    try{
      me = await api('/api/me');
    }catch(e){
      window.location.href = '/login.html';
      return;
    }
    if(!me) return;

    document.getElementById('whoBox').innerHTML = `
      <b>${escapeHtml(me.name)}</b>
      <span class="role-pill">${me.role}${me.class ? ' · ' + escapeHtml(me.class) : ''}</span>
    ` + document.getElementById('whoBox').innerHTML;
    document.getElementById('footerWho').textContent = `${me.name} (${me.role})`;

    if(me.role === 'admin'){
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    }

    setupTabs();
    setupLogout();
    setupStudents();
    setupAddStudent();
    setupModal();
    setupInsights();
    if(me.role === 'admin') setupUserManagement();
    setupAccount();

    await refreshStats();
    await loadStudents();
  }

  function setupTabs(){
    document.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
        if(btn.dataset.tab === 'insights') await loadInsights();
        if(btn.dataset.tab === 'users') await loadUsers();
      });
    });
  }

  function setupLogout(){
    document.getElementById('logoutBtn').addEventListener('click', async ()=>{
      await api('/api/logout', { method:'POST' });
      window.location.href = '/login.html';
    });
  }

  async function refreshStats(){
    const stats = await api('/api/stats');
    const strip = document.getElementById('statStrip');
    strip.innerHTML = `
      <div><b>${stats.studentCount}</b>students</div>
      <div><b>${stats.classCount}</b>${me.role==='admin' ? 'classes' : 'your class'}</div>
      <div><b>${stats.resultCount}</b>results logged</div>
    `;
  }

  // ---------- Students ----------
  function setupStudents(){
    document.getElementById('searchInput').addEventListener('input', debounce(loadStudents, 250));
    document.getElementById('classFilter').addEventListener('change', loadStudents);
    document.getElementById('exportBtn').addEventListener('click', exportCsv);
  }

  function debounce(fn, ms){
    let t;
    return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
  }

  let lastStudents = [];

  async function loadStudents(){
    const q = document.getElementById('searchInput').value.trim();
    const cls = document.getElementById('classFilter').value;
    const params = new URLSearchParams();
    if(q) params.set('q', q);
    if(cls) params.set('class', cls);
    const students = await api('/api/students?' + params.toString());
    lastStudents = students;
    renderClassFilter(students);
    renderGrid(students);
  }

  function renderClassFilter(students){
    if(me.role !== 'admin') return; // teachers only see their own class anyway
    const sel = document.getElementById('classFilter');
    const current = sel.value;
    // Use full unfiltered class list only once; approximate via current students for simplicity
    const classes = [...new Set(students.map(s=>s.class))].sort();
    sel.innerHTML = '<option value="">All classes</option>' + classes.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    sel.value = current;
  }

  function renderGrid(students){
    const grid = document.getElementById('studentGrid');
    document.getElementById('emptyState').style.display = students.length === 0 ? 'block' : 'none';
    grid.innerHTML = students.map(s => `
      <div class="scard" data-id="${s.id}">
        <div class="sid">${escapeHtml(s.student_code)}</div>
        <div class="sname">${escapeHtml(s.name)}</div>
        <div class="smeta">
          <span class="badge">${escapeHtml(s.class)}</span>
          <span class="badge">${escapeHtml(s.session)}</span>
          ${s.average_score != null ? `<span class="badge">avg ${s.average_score}</span>` : ''}
        </div>
      </div>
    `).join('');
    grid.querySelectorAll('.scard').forEach(card=>{
      card.addEventListener('click', ()=>openModal(card.dataset.id));
    });
  }

  function exportCsv(){
    if(lastStudents.length === 0){ alert('No students to export.'); return; }
    let rows = [['Student Code','Name','Class','Session','Result Count','Average Score']];
    lastStudents.forEach(s=>{
      rows.push([s.student_code, s.name, s.class, s.session, s.result_count, s.average_score ?? '']);
    });
    const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'students_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Add student ----------
  function setupAddStudent(){
    document.getElementById('saveStudentBtn').addEventListener('click', async ()=>{
      const msg = document.getElementById('addMsg');
      msg.innerHTML = '';
      const name = document.getElementById('f_name').value.trim();
      const className = document.getElementById('f_class').value.trim();
      if(!name || !className){
        msg.innerHTML = '<div class="error-msg">Name and class are required.</div>';
        return;
      }
      try{
        await api('/api/students', {
          method:'POST',
          body: JSON.stringify({
            name,
            class: className,
            session: document.getElementById('f_session').value,
            guardian: document.getElementById('f_guardian').value.trim(),
            contact: document.getElementById('f_contact').value.trim(),
            notes: document.getElementById('f_notes').value.trim()
          })
        });
        ['f_name','f_class','f_guardian','f_contact','f_notes'].forEach(id=>document.getElementById(id).value='');
        msg.innerHTML = '<div class="success-msg">Student added.</div>';
        await refreshStats();
        await loadStudents();
        setTimeout(()=>{ document.querySelector('[data-tab="students"]').click(); }, 500);
      }catch(e){
        msg.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      }
    });
  }

  // ---------- Modal / results ----------
  function setupModal(){
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('overlay').addEventListener('click', (e)=>{
      if(e.target.id === 'overlay') closeModal();
    });
    document.getElementById('addResultBtn').addEventListener('click', addResult);
    document.getElementById('deleteStudentBtn').addEventListener('click', deleteStudent);
  }

  function closeModal(){
    document.getElementById('overlay').classList.remove('active');
    activeStudentId = null;
  }

  async function openModal(id){
    activeStudentId = id;
    const s = await api('/api/students/' + id);
    document.getElementById('m_name').textContent = s.name;
    document.getElementById('m_meta').textContent = `${s.student_code} · ${s.class} · ${s.session} session`;
    let details = '';
    if(s.guardian) details += `Guardian: ${escapeHtml(s.guardian)}<br>`;
    if(s.contact) details += `Contact: ${escapeHtml(s.contact)}<br>`;
    if(s.notes) details += `Notes: ${escapeHtml(s.notes)}`;
    document.getElementById('m_details').innerHTML = details;
    renderResultsTable(s.results);
    document.getElementById('overlay').classList.add('active');
  }

  function renderResultsTable(results){
    const body = document.getElementById('m_resultsBody');
    if(results.length === 0){
      body.innerHTML = `<tr><td colspan="5" style="color:var(--slate); font-size:13px;">No results logged yet.</td></tr>`;
      return;
    }
    body.innerHTML = results.map(r=>{
      const g = gradeFor(r.score);
      return `<tr>
        <td>${escapeHtml(r.subject)}</td>
        <td>${escapeHtml(r.term)}</td>
        <td>${r.score}</td>
        <td><span class="grade-pill g-${g}">${g}</span></td>
        <td><button class="ghost" style="padding:3px 8px; font-size:11px;" data-result-id="${r.id}">Remove</button></td>
      </tr>`;
    }).join('');
    body.querySelectorAll('button[data-result-id]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        await api('/api/results/' + btn.dataset.resultId, { method:'DELETE' });
        await openModal(activeStudentId);
        await refreshStats();
        await loadStudents();
      });
    });
  }

  async function addResult(){
    const subject = document.getElementById('r_subject').value.trim();
    const term = document.getElementById('r_term').value.trim();
    const score = document.getElementById('r_score').value;
    if(!subject || !term || score === ''){
      alert('Please fill subject, term, and score.');
      return;
    }
    try{
      await api(`/api/students/${activeStudentId}/results`, {
        method:'POST',
        body: JSON.stringify({ subject, term, score })
      });
      document.getElementById('r_subject').value = '';
      document.getElementById('r_term').value = '';
      document.getElementById('r_score').value = '';
      await openModal(activeStudentId);
      await refreshStats();
      await loadStudents();
    }catch(e){
      alert(e.message);
    }
  }

  async function deleteStudent(){
    if(!confirm('Delete this student and all their results? This cannot be undone.')) return;
    await api('/api/students/' + activeStudentId, { method:'DELETE' });
    closeModal();
    await refreshStats();
    await loadStudents();
  }

  // ---------- Insights ----------
  function setupInsights(){}

  async function loadInsights(){
    const stats = await api('/api/stats');
    const chart = document.getElementById('barChart');
    const hint = document.getElementById('noResultsHint');
    if(stats.avgByClass.length === 0){
      chart.innerHTML = '';
      hint.style.display = 'block';
      return;
    }
    hint.style.display = 'none';
    chart.innerHTML = stats.avgByClass.map(row => `
      <div class="bar-row">
        <div>${escapeHtml(row.class)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${row.avg}%;"></div></div>
        <div>${row.avg}</div>
      </div>
    `).join('');
  }

  // ---------- User management (admin) ----------
  function setupUserManagement(){
    const roleSel = document.getElementById('u_role');
    const classRow = document.getElementById('u_classRow');
    roleSel.addEventListener('change', ()=>{
      classRow.style.display = roleSel.value === 'teacher' ? '' : 'none';
    });

    document.getElementById('createUserBtn').addEventListener('click', async ()=>{
      const msg = document.getElementById('userMsg');
      msg.innerHTML = '';
      const name = document.getElementById('u_name').value.trim();
      const email = document.getElementById('u_email').value.trim();
      const password = document.getElementById('u_password').value;
      const role = roleSel.value;
      const className = document.getElementById('u_class').value.trim();
      try{
        await api('/api/users', {
          method:'POST',
          body: JSON.stringify({ name, email, password, role, class: className })
        });
        msg.innerHTML = '<div class="success-msg">Account created.</div>';
        ['u_name','u_email','u_password','u_class'].forEach(id=>document.getElementById(id).value='');
        await loadUsers();
      }catch(e){
        msg.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      }
    });
  }

  async function loadUsers(){
    if(me.role !== 'admin') return;
    const users = await api('/api/users');
    const body = document.getElementById('usersBody');
    body.innerHTML = users.map(u => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${u.role}</td>
        <td>${escapeHtml(u.class || '—')}</td>
        <td>${u.id === me.id ? '' : `<button class="ghost" style="padding:3px 8px; font-size:11px;" data-user-id="${u.id}">Remove</button>`}</td>
      </tr>
    `).join('');
    body.querySelectorAll('button[data-user-id]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('Remove this user account?')) return;
        await api('/api/users/' + btn.dataset.userId, { method:'DELETE' });
        await loadUsers();
      });
    });
  }

  // ---------- Account ----------
  function setupAccount(){
    document.getElementById('changePwBtn').addEventListener('click', async ()=>{
      const msg = document.getElementById('pwMsg');
      msg.innerHTML = '';
      const currentPassword = document.getElementById('pw_current').value;
      const newPassword = document.getElementById('pw_new').value;
      try{
        await api('/api/change-password', {
          method:'POST',
          body: JSON.stringify({ currentPassword, newPassword })
        });
        msg.innerHTML = '<div class="success-msg">Password updated.</div>';
        document.getElementById('pw_current').value = '';
        document.getElementById('pw_new').value = '';
      }catch(e){
        msg.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      }
    });
  }

  init();
})();
