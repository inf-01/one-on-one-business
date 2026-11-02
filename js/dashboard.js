/* ============================================================
   ONE ON ONE BUSINESS — Dashboard de métricas (estilo neumórfico puro)
   - Total completadas vs pendientes
   - Rendimiento por usuario (José vs Luis)
   - Velocidad de finalización (FechaCreacion → FechaFinalizacion)
   ============================================================ */
(function(){
  'use strict';

  /* Restaurar el tema elegido en el calendario (mismo localStorage) */
  try{
    const t = localStorage.getItem('neu_theme');
    if(t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }catch(e){}

  const API = window.API;
  const USER_JOSE = 'José';
  const USER_LUIS = 'Luis';
  const $ = id => document.getElementById(id);

  function avgHours(list){
    const done = list.filter(t =>
      t.estado === 'completada' && t.fechaCreacion && t.fechaFinalizacion
    );
    if(!done.length) return null;
    let sum = 0;
    done.forEach(t=>{
      const ms = new Date(t.fechaFinalizacion) - new Date(t.fechaCreacion);
      sum += Math.max(0, ms) / 3600000; // horas, sin valores negativos
    });
    return sum / done.length;
  }

  function fmtDuration(h){
    if(h === null || isNaN(h)) return '—';
    if(h < 48) return h.toFixed(1) + ' h';
    return (h / 24).toFixed(1) + ' d';
  }

  function paint(tasks){
    const total = tasks.length;
    const done = tasks.filter(t => t.estado === 'completada');
    const pending = total - done.length;
    const pctGlobal = total ? Math.round((done.length / total) * 100) : 0;

    $('statDone').textContent = done.length;
    $('statPending').textContent = pending;
    $('statTotal').textContent = total;
    $('globalFill').style.width = pctGlobal + '%';
    $('globalCount').textContent = done.length + '/' + total;

    /* Rendimiento por usuario */
    [[USER_JOSE, 'jose'], [USER_LUIS, 'luis']].forEach(([user, key])=>{
      const mine = tasks.filter(t => t.responsable === user);
      const mineDone = mine.filter(t => t.estado === 'completada').length;
      const pct = mine.length ? Math.round((mineDone / mine.length) * 100) : 0;
      $(key + 'Fill').style.width = pct + '%';
      $(key + 'Meta').textContent = mineDone + '/' + mine.length + ' completadas · ' + pct + '%';
    });

    /* Velocidad de finalización */
    $('speedAvg').textContent = fmtDuration(avgHours(tasks));
    $('speedJose').textContent = fmtDuration(avgHours(tasks.filter(t => t.responsable === USER_JOSE)));
    $('speedLuis').textContent = fmtDuration(avgHours(tasks.filter(t => t.responsable === USER_LUIS)));

    $('dashNote').textContent = 'Última actualización: ' +
      new Date().toLocaleString('es-ES');
  }

  async function load(){
    $('dashNote').textContent = 'Sincronizando con la API…';
    try{
      const data = await API.getTasks();
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      paint(tasks);
      if(!tasks.length){
        $('dashNote').textContent = 'Sin tareas todavía. Crea una desde el calendario y vuelve aquí.';
      }
    }catch(err){
      $('dashNote').textContent = '⚠ No se pudo cargar la API: ' + err.message;
    }
  }

  $('refreshBtn').addEventListener('click', (e)=>{
    e.preventDefault();
    load();
  });

  load();
})();
