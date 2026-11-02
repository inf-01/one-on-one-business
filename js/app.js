/* ============================================================
   ONE ON ONE BUSINESS — Calendario SEMANAL (Dom–Sáb) con API en la nube
   - 7 días de la semana actual, ‹ › navegan entre semanas
   - Título con rango: "Sem 44: 27 Oct - 02 Nov"
   - Progreso GENERAL (toolbar) + PROGRESO PERSONAL (panel)
   - Colores: José = Cian (--neon) · Luis = Magenta (--neon2)
   - Modal Minuta: pegar texto → API
   - localStorage REEMPLAZADO por fetch() a /api/sync
   ============================================================ */
(function(){
  'use strict';

  const API = window.API;
  const USER_JOSE = 'José';
  const USER_LUIS = 'Luis';
  const MON_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  /* ---------- Preferencias de UI (solo tema/alarma/usuario) ----------
     Los DATOS del proyecto nunca se guardan en localStorage: van a la API. */
  function prefGet(k, d){ try{ const v = localStorage.getItem(k); return v === null ? d : v; }catch(e){ return d; } }
  function prefSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

  /* ---------- Estado ---------- */
  let tasks = [];                       // tareas desde la API
  let currentUser = prefGet('neu_active_user', USER_JOSE) === USER_LUIS ? USER_LUIS : USER_JOSE;

  const today = new Date();
  let viewWeek = weekStart(today);      // domingo de la semana visible
  let selected = fmt(today);

  /* ---------- Fechas ---------- */
  function fmt(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
  function weekStart(d){
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() - r.getDay()); // Dom = 0
    return r;
  }
  /* Número de semana ISO de un día cualquiera */
  function isoWeekNumber(date){
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function weekRangeText(){
    const end = addDays(viewWeek, 6);
    const n = isoWeekNumber(viewWeek);
    return 'Sem ' + n + ': ' + viewWeek.getDate() + ' ' + MON_SHORT[viewWeek.getMonth()] +
           ' - ' + end.getDate() + ' ' + MON_SHORT[end.getMonth()];
  }

  /* ---------- Feriados de Costa Rica (sin cambios) ---------- */
  const holidayCache = {};
  function easterSunday(year){
    const a = year % 19, b = Math.floor(year/100), c = year % 100;
    const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
    const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15) % 30;
    const i = Math.floor(c/4), k = c % 4, l = (32+2*e+2*i-h-k) % 7;
    const m = Math.floor((a+11*h+22*l)/451);
    const month = Math.floor((h+l-7*m+114)/31);
    const day = ((h+l-7*m+114) % 31) + 1;
    return new Date(year, month-1, day);
  }
  function getHolidays(year){
    if(holidayCache[year]) return holidayCache[year];
    const easter = easterSunday(year);
    const set = new Set([
      year+'-01-01',
      fmt(addDays(easter,-3)),
      fmt(addDays(easter,-2)),
      year+'-04-11',
      year+'-05-01',
      year+'-07-25',
      year+'-08-02',
      year+'-08-15',
      year+'-09-15',
      year+'-12-25',
    ]);
    holidayCache[year] = set;
    return set;
  }

  /* ---------- Helpers de datos ---------- */
  function tasksOn(dateKey){ return tasks.filter(t => t.fecha === dateKey); }
  function isDone(t){ return t.estado === 'completada'; }

  /* ---------- DOM ---------- */
  const grid = document.getElementById('grid');
  const marqueeTrack = document.getElementById('marqueeTrack');
  const selTitle = document.getElementById('selTitle');
  const eventList = document.getElementById('eventList');
  const generalFill = document.getElementById('generalFill');
  const generalCount = document.getElementById('generalCount');
  const personalFill = document.getElementById('personalFill');
  const personalCount = document.getElementById('personalCount');
  const personalLabel = document.getElementById('personalLabel');

  const toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast);
  function showToast(msg){
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=> toast.classList.remove('show'), 3500);
  }

  /* ---------- Iconos "pixel art" en ALTA DEFINICIÓN (matriz 15×15 a 2px) ----------
     Misma técnica box-shadow píxel a píxel + glow cian, pero con el doble de
     resolución que el diseño original (7×7 a 3px) para mayor nitidez. */
  let iconColor = '#00F0FF';
  const PX_STEP = 2; // 15 píxeles lógicos × 2px = 30px de arte (centrado con margin -15px)

  function pxShadow(rows, color, step){
    step = step || PX_STEP;
    const out = [];
    for(let y = 0; y < rows.length; y++){
      const row = rows[y];
      for(let x = 0; x < row.length; x++){
        if(row[x] === '#') out.push((x*step)+'px '+(y*step)+'px 0 0 '+color);
      }
    }
    return out.join(',');
  }
  function drawPx(el, rows, color){
    el.style.boxShadow = pxShadow(rows, color || iconColor);
  }

  const ICONS = {
    /* Sol: disco + 8 rayos */
    sun: [
      '.......#.......',
      '.#.....#.....#.',
      '..#.........#..',
      '......###......',
      '.....#####.....',
      '....#######....',
      '...#########...',
      '##.#########.##',
      '...#########...',
      '....#######....',
      '.....#####.....',
      '......###......',
      '..#.........#..',
      '.#.....#.....#.',
      '.......#.......'
    ],
    /* Luna: creciente abierto a la derecha */
    moon: [
      '.......#.......',
      '....#######....',
      '...######......',
      '..######.......',
      '.######........',
      '.#####.........',
      '.#####.........',
      '######.........',
      '.#####.........',
      '.#####.........',
      '.######........',
      '..######.......',
      '...######......',
      '....#######....',
      '.......#.......'
    ],
    /* Campana (encendida) */
    bell: [
      '.......#.......',
      '......###......',
      '.....#####.....',
      '.....#####.....',
      '....#######....',
      '....#######....',
      '...#########...',
      '...#########...',
      '..###########..',
      '..###########..',
      '.#############.',
      '.#############.',
      '...............',
      '......###......',
      '...............'
    ],
    /* Tacha diagonal de la campana apagada */
    slash: [
      '..............#',
      '.............#.',
      '............#..',
      '...........#...',
      '..........#....',
      '.........#.....',
      '........#......',
      '.......#.......',
      '......#........',
      '.....#.........',
      '....#..........',
      '...#...........',
      '..#............',
      '.#.............',
      '#..............'
    ],
    /* Flecha hacia abajo (exportar) */
    down: [
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '..###########..',
      '...#########...',
      '....#######....',
      '.....#####.....',
      '......###......',
      '.......#.......',
      '...............'
    ],
    /* Flecha hacia arriba (importar) */
    up: [
      '...............',
      '.......#.......',
      '......###......',
      '.....#####.....',
      '....#######....',
      '...#########...',
      '..###########..',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......',
      '.......#.......'
    ],
    /* Documento de minuta */
    doc: [
      '...#######.....',
      '..#.........#..',
      '..#.........#..',
      '..#.........#..',
      '..#.#######.#..',
      '..#.........#..',
      '..#.........#..',
      '..#.#######.#..',
      '..#.........#..',
      '..#.........#..',
      '..#.#####...#..',
      '..#.........#..',
      '..#.........#..',
      '..#.........#..',
      '...#######.....'
    ],
    /* Gráfica de barras (dashboard) */
    chart: [
      '...............',
      '...............',
      '...............',
      '......###......',
      '......###......',
      '......###......',
      '......###..###.',
      '......###..###.',
      '......###..###.',
      '..###..###..###',
      '..###..###..###',
      '..###..###..###',
      '..###..###..###',
      '..###..###..###',
      '..###..###..###'
    ]
  };
  drawPx(document.getElementById('exportIcon'), ICONS.down);
  drawPx(document.getElementById('importIcon'), ICONS.up);
  drawPx(document.getElementById('minutaIcon'), ICONS.doc);
  drawPx(document.getElementById('dashIcon'), ICONS.chart);

  /* ---------- Tema claro/oscuro (botón reubicado en el header) ---------- */
  const themeBtn = document.getElementById('themeBtn');
  const themeIcon = document.getElementById('themeIcon');
  function applyTheme(t){
    if(t){ document.documentElement.setAttribute('data-theme', t); }
    else{ document.documentElement.removeAttribute('data-theme'); }
    const isLight = t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches);
    iconColor = '#00F0FF';
    drawPx(themeIcon, isLight ? ICONS.sun : ICONS.moon);
  }
  applyTheme(prefGet('neu_theme', null));
  themeBtn.addEventListener('click', ()=>{
    const current = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    prefSet('neu_theme', next);
  });

  /* ---------- Sonidos (dopamina) via Web Audio API ---------- */
  let audioCtx = null;
  function getCtx(){
    if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
    return audioCtx;
  }
  function tone(freq, start, dur, type, gain){
    const ctx = getCtx(); if(!ctx) return;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = type||'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime+start);
    g.gain.linearRampToValueAtTime(gain||.18, ctx.currentTime+start+.02);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime+start+dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(ctx.currentTime+start); osc.stop(ctx.currentTime+start+dur+.05);
  }
  function playSuccessSound(){
    tone(523.25,0,.14,'triangle'); tone(659.25,.09,.14,'triangle'); tone(783.99,.18,.22,'triangle');
  }
  function playAlarmSound(){
    tone(880,0,.15,'sine',.22); tone(880,.22,.15,'sine',.22); tone(880,.44,.22,'sine',.22);
  }

  /* ---------- Notificaciones / alarma 5 min antes ---------- */
  const alarmBtn = document.getElementById('alarmBtn');
  let alarmsOn = prefGet('neu_alarms', '0') === '1';
  const notifiedIds = new Set(); // en memoria: no se reavisa al recargar
  const alarmIcon = document.getElementById('alarmIcon');
  function refreshAlarmBtn(){
    alarmBtn.classList.toggle('active', alarmsOn); iconColor = '#00F0FF';
    if(alarmsOn){
      drawPx(alarmIcon, ICONS.bell);
    }else{
      /* Cuerpo de campana en cian + tacha diagonal en cyan apagado */
      alarmIcon.style.boxShadow =
        pxShadow(ICONS.bell, iconColor) + ',' + pxShadow(ICONS.slash, '#0088AA');
    }
  }
  refreshAlarmBtn();
  alarmBtn.addEventListener('click', async ()=>{
    if(!alarmsOn){
      if('Notification' in window && Notification.permission !== 'granted'){
        try{ await Notification.requestPermission(); }catch(e){}
      }
      alarmsOn = true; showToast('Alarmas activadas: avisamos 5 min antes de cada tarea');
    }else{
      alarmsOn = false; showToast('Alarmas desactivadas');
    }
    prefSet('neu_alarms', alarmsOn ? '1' : '0');
    refreshAlarmBtn();
  });
  function triggerAlarm(t){
    playAlarmSound();
    if('Notification' in window && Notification.permission === 'granted'){
      try{ new Notification('⏰ En 5 minutos: ' + t.titulo, { body: t.hora || '' }); }catch(e){}
    }
    showToast('⏰ En 5 min: ' + t.titulo);
  }
  function checkAlarms(){
    if(!alarmsOn) return;
    const now = new Date();
    tasks.forEach(t=>{
      if(!t.hora || isDone(t) || notifiedIds.has(t.id) || !t.fecha) return;
      const evDate = new Date(t.fecha + 'T' + t.hora + ':00');
      const diffMs = evDate - now;
      if(diffMs > 0 && diffMs <= 5*60*1000){
        triggerAlarm(t); notifiedIds.add(t.id);
      }
    });
  }
  setInterval(checkAlarms, 20000);
  checkAlarms();

  /* ---------- Marquee: rango de la semana + tareas del día ---------- */
  function updateMarquee(){
    const dayTasks = tasksOn(selected);
    let text = weekRangeText().toUpperCase();
    if(dayTasks.length){
      const abbr = dayTasks.slice(0, 6).map(t=>{
        const s = t.titulo.length > 16 ? t.titulo.slice(0, 16) + '…' : t.titulo;
        return (isDone(t) ? '✓ ' : '') + s + (t.hora ? ' ' + t.hora : '');
      }).join('   •   ');
      text += '   •   ' + abbr;
    }
    const full = text + '   •   ' + text;
    marqueeTrack.textContent = full;
    const dur = Math.max(8, text.length * 0.16);
    marqueeTrack.style.animationDuration = dur + 's';
  }

  /* ---------- Exportar / Importar respaldo (ahora vía API) ---------- */
  document.getElementById('exportBtn').addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'micro-tareas-respaldo.json'; a.click();
    URL.revokeObjectURL(url);
    showToast('Respaldo descargado ✓');
  });
  document.getElementById('importInput').addEventListener('change', (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async ()=>{
      try{
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : (data.tasks || []);
        if(!list.length) throw new Error('vacío');
        const payload = list.map(normalizeTask).filter(t => t.titulo);
        await API.bulkCreate(payload);
        await reload();
        render();
        showToast(payload.length + ' tareas importadas ✓');
      }catch(err){ showToast('Archivo inválido'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ---------- Sincronización con la API ---------- */
  function normalizeTask(raw){
    raw = raw || {};
    return {
      id: raw.id || null,
      fecha: String(raw.fecha || selected),
      titulo: String(raw.titulo || ''),
      responsable: raw.responsable === USER_LUIS ? USER_LUIS : USER_JOSE,
      estado: raw.estado === 'completada' ? 'completada' : 'pendiente',
      fechaCreacion: raw.fechaCreacion || new Date().toISOString(),
      fechaFinalizacion: raw.fechaFinalizacion || '',
      hora: String(raw.hora || '')
    };
  }
  async function reload(){
    try{
      const data = await API.getTasks();
      tasks = Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [];
    }catch(err){
      tasks = [];
      showToast('⚠ No se pudo sincronizar: ' + err.message);
    }
  }

  /* ---------- Render: grid SEMANAL (7 celdas Dom–Sáb) ---------- */
  function render(){
    updateMarquee();
    grid.innerHTML = '';

    for(let i = 0; i < 7; i++){
      const cellDate = addDays(viewWeek, i);
      const key = fmt(cellDate);
      const isHoliday = getHolidays(cellDate.getFullYear()).has(key);

      const cell = document.createElement('div');
      cell.className = 'day' +
        (cellDate.getDay() === 0 ? ' wd0' : '') +
        (isHoliday ? ' holiday' : '') +
        (key === fmt(today) ? ' today' : '') +
        (key === selected ? ' selected' : '');
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.dataset.date = key;

      const num = document.createElement('span');
      num.textContent = cellDate.getDate();
      cell.appendChild(num);

      const dayTasks = tasksOn(key);
      if(dayTasks.length){
        const dots = document.createElement('div');
        dots.className = 'dots';
        dayTasks.slice(0, 3).forEach(t=>{
          const d = document.createElement('span');
          d.className = 'dot ' + (t.responsable === USER_LUIS ? 'luis' : 'jose');
          dots.appendChild(d);
        });
        cell.appendChild(dots);
      }

      cell.addEventListener('click', ()=>{
        selected = key;
        render();
      });
      cell.addEventListener('keydown', (ev)=>{
        if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); cell.click(); }
      });

      grid.appendChild(cell);
    }

    renderEvents();
  }

  /* ---------- Render: panel + barras de progreso ---------- */
  function renderEvents(){
    const d = new Date(selected + 'T00:00:00');
    const label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    selTitle.textContent = label.charAt(0).toUpperCase() + label.slice(1);

    const list = tasksOn(selected).slice().sort((a, b)=> (a.hora || '99:99').localeCompare(b.hora || '99:99'));
    eventList.innerHTML = '';

    /* GENERAL = José + Luis del día seleccionado */
    const gTotal = list.length;
    const gDone = list.filter(isDone).length;
    const gPct = gTotal ? Math.round((gDone / gTotal) * 100) : 0;
    generalFill.style.width = gPct + '%';
    generalCount.textContent = gDone + '/' + gTotal;

    /* PERSONAL = solo el usuario activo */
    const mine = list.filter(t => t.responsable === currentUser);
    const mTotal = mine.length;
    const mDone = mine.filter(isDone).length;
    const mPct = mTotal ? Math.round((mDone / mTotal) * 100) : 0;
    personalLabel.textContent = 'Progreso ' + currentUser;
    personalFill.className = 'progress-fill ' + (currentUser === USER_LUIS ? 'luis' : 'jose');
    personalFill.style.width = mPct + '%';
    personalCount.textContent = mDone + '/' + mTotal;

    if(!list.length){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No hay eventos este día. Toca + para agregar uno.';
      eventList.appendChild(empty);
      return;
    }

    list.forEach(t=>{
      const row = document.createElement('div');
      row.className = 'neu-inset event' + (isDone(t) ? ' done' : '');
      row.innerHTML = `
        <div class="check" aria-label="Marcar como completada">✓</div>
        <div class="bar ${t.responsable === USER_LUIS ? 'luis' : 'jose'}"></div>
        <div class="info">
          <div class="t"></div>
          <div class="h"></div>
        </div>
        <button class="neu-btn del" aria-label="Eliminar evento">✕</button>
      `;
      row.querySelector('.t').textContent = t.titulo;
      row.querySelector('.h').textContent =
        t.responsable + ' · ' + (t.hora ? t.hora : 'Todo el día') + (isDone(t) ? ' · ✓' : '');

      row.querySelector('.check').addEventListener('click', async ()=>{
        const next = isDone(t) ? 'pendiente' : 'completada';
        try{
          const data = await API.updateTask(t.id, { estado: next });
          Object.assign(t, normalizeTask(Object.assign({}, t, data.task)));
          if(isDone(t)) playSuccessSound();
          render();
          if(isDone(t) && mTotal > 0 && mDone + 1 === mTotal){
            setTimeout(()=>{
              tone(1046.5,0,.12,'triangle'); tone(1318.5,.1,.12,'triangle'); tone(1568,.2,.3,'triangle');
              showToast('🎉 ¡Todas las tareas completadas!');
            }, 150);
          }
        }catch(err){
          showToast('⚠ ' + err.message);
          await reload(); render();
        }
      });

      row.querySelector('.del').addEventListener('click', async ()=>{
        try{
          await API.deleteTask(t.id);
          tasks = tasks.filter(x => x.id !== t.id);
          render();
          showToast('Tarea eliminada ✓');
        }catch(err){
          showToast('⚠ ' + err.message);
          await reload(); render();
        }
      });

      eventList.appendChild(row);
    });
  }

  /* ---------- Navegación semanal ---------- */
  document.getElementById('prevBtn').addEventListener('click', ()=>{
    viewWeek = addDays(viewWeek, -7); render();
  });
  document.getElementById('nextBtn').addEventListener('click', ()=>{
    viewWeek = addDays(viewWeek, 7); render();
  });
  document.getElementById('todayBtn').addEventListener('click', ()=>{
    viewWeek = weekStart(today); selected = fmt(today); render();
  });

  /* ---------- Dashboard ---------- */
  document.getElementById('dashBtn').addEventListener('click', ()=>{
    location.href = 'dashboard.html';
  });

  /* ---------- Selector de usuario (panel personal) ---------- */
  const userToggle = document.getElementById('userToggle');
  function paintUserToggle(){
    userToggle.querySelectorAll('.user-chip').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.user === currentUser);
    });
  }
  userToggle.addEventListener('click', (e)=>{
    const btn = e.target.closest('.user-chip');
    if(!btn) return;
    currentUser = btn.dataset.user === USER_LUIS ? USER_LUIS : USER_JOSE;
    prefSet('neu_active_user', currentUser);
    paintUserToggle();
    renderEvents();
  });
  paintUserToggle();

  /* ---------- Modal: nuevo evento ---------- */
  const overlay = document.getElementById('overlay');
  const evTitle = document.getElementById('evTitle');
  const evTime = document.getElementById('evTime');
  const evUserToggle = document.getElementById('evUserToggle');
  let evUser = currentUser;

  function paintEvUser(){
    evUserToggle.querySelectorAll('.user-chip').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.user === evUser);
    });
  }
  evUserToggle.addEventListener('click', (e)=>{
    const btn = e.target.closest('.user-chip');
    if(!btn) return;
    evUser = btn.dataset.user === USER_LUIS ? USER_LUIS : USER_JOSE;
    paintEvUser();
  });

  document.getElementById('addBtn').addEventListener('click', ()=>{
    evTitle.value = ''; evTime.value = '';
    evUser = currentUser; paintEvUser();
    overlay.classList.add('open');
    setTimeout(()=> evTitle.focus(), 50);
  });
  document.getElementById('cancelBtn').addEventListener('click', ()=> overlay.classList.remove('open'));
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) overlay.classList.remove('open'); });

  document.getElementById('saveBtn').addEventListener('click', async ()=>{
    const title = evTitle.value.trim();
    if(!title){ evTitle.focus(); return; }
    const task = normalizeTask({
      fecha: selected,
      titulo: title,
      responsable: evUser,
      estado: 'pendiente',
      fechaCreacion: new Date().toISOString(),
      hora: evTime.value || ''
    });
    try{
      const data = await API.createTask(task);
      tasks.push(normalizeTask(data.task));
      overlay.classList.remove('open');
      render();
      showToast('Tarea agregada ✓');
    }catch(err){
      showToast('⚠ ' + err.message);
    }
  });
  evTitle.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') document.getElementById('saveBtn').click(); });

  /* ---------- Modal: MINUTA (pegar texto → API) ---------- */
  const minutaOverlay = document.getElementById('minutaOverlay');
  const minutaText = document.getElementById('minutaText');
  const minutaUserToggle = document.getElementById('minutaUserToggle');
  let minutaUser = currentUser;

  function paintMinutaUser(){
    minutaUserToggle.querySelectorAll('.user-chip').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.user === minutaUser);
    });
  }
  minutaUserToggle.addEventListener('click', (e)=>{
    const btn = e.target.closest('.user-chip');
    if(!btn) return;
    minutaUser = btn.dataset.user === USER_LUIS ? USER_LUIS : USER_JOSE;
    paintMinutaUser();
  });

  document.getElementById('minutaBtn').addEventListener('click', ()=>{
    minutaText.value = '';
    minutaUser = currentUser; paintMinutaUser();
    minutaOverlay.classList.add('open');
    setTimeout(()=> minutaText.focus(), 50);
  });
  document.getElementById('minutaCancelBtn').addEventListener('click', ()=> minutaOverlay.classList.remove('open'));
  minutaOverlay.addEventListener('click', (e)=>{ if(e.target === minutaOverlay) minutaOverlay.classList.remove('open'); });

  document.getElementById('minutaProcessBtn').addEventListener('click', async ()=>{
    const lines = minutaText.value.split('\n').map(s => s.trim()).filter(Boolean);
    if(!lines.length){ minutaText.focus(); showToast('Pega al menos una línea de texto'); return; }
    const nowIso = new Date().toISOString();
    const payload = lines.map(line=> normalizeTask({
      fecha: selected,
      titulo: line.slice(0, 120),
      responsable: minutaUser,
      estado: 'pendiente',
      fechaCreacion: nowIso,
      hora: ''
    }));
    try{
      const data = await API.bulkCreate(payload);
      (data.tasks || []).forEach(t => tasks.push(normalizeTask(t)));
      minutaOverlay.classList.remove('open');
      render();
      showToast(payload.length + ' tareas creadas desde la minuta ✓');
    }catch(err){
      showToast('⚠ ' + err.message);
    }
  });
  minutaText.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('minutaProcessBtn').click();
    if(e.key === 'Escape') minutaOverlay.classList.remove('open');
  });

  /* ---------- Init ---------- */
  (async function init(){
    await reload();
    render();
  })();
})();
