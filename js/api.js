/* ============================================================
   ONE ON ONE BUSINESS — Cliente de API (compartido: index + dashboard)
   Todo pasa por /api/sync (Serverless Function de Vercel),
   que a su vez habla con Google Apps Script de forma segura.
   ============================================================ */
(function(){
  'use strict';

  const BASE = '/api/sync';

  async function request(url, options){
    let res;
    try{
      res = await fetch(url, options || {});
    }catch(e){
      throw new Error('Sin conexión con el servidor');
    }
    let data = null;
    try{ data = await res.json(); }
    catch(e){ throw new Error('Respuesta inválida del servidor'); }

    if(!res.ok || data === null || data.ok === false){
      throw new Error((data && data.error) ? data.error : ('Error HTTP ' + res.status));
    }
    return data;
  }

  function post(payload){
    return request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  window.API = {
    /* Lectura */
    getTasks(){
      return request(BASE + '?action=getTasks');
    },
    /* Escritura */
    createTask(task){
      return post({ action: 'create', task: task });
    },
    updateTask(id, changes){
      return post({ action: 'update', id: id, changes: changes });
    },
    deleteTask(id){
      return post({ action: 'delete', id: id });
    },
    bulkCreate(tasks){
      return post({ action: 'bulk', tasks: tasks });
    }
  };
})();
