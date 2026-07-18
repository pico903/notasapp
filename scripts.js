// scripts.js — Vanilla JS para manejar notas (crear, editar, borrar)
(function(){
  const SUPABASE_URL = 'https://mtbxxaitvrfpoxqjljqh.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_OQ7vnw2f1G7Ut6pO9wJU1w_Qak8akYi';
  const TABLE_NAME = 'notas';
  const CATEGORY_ID_BY_LABEL = { trabajo: 1, ideas: 2, personal: 3 };
  const LABEL_BY_CATEGORY_ID = { 1: 'trabajo', 2: 'ideas', 3: 'personal' };

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function getCategoryId(category){
    return CATEGORY_ID_BY_LABEL[category] ?? null;
  }

  function getCategoryFromId(categoryId){
    return LABEL_BY_CATEGORY_ID[categoryId] ?? '';
  }

  function createNoteId(){
    if(window.uuid && typeof window.uuid.v4 === 'function'){
      return window.uuid.v4();
    }
    if(window.crypto && typeof window.crypto.randomUUID === 'function'){
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function isValidUuid(value){
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function normalizeNoteId(note){
    const rawId = note && note.id;
    if(isValidUuid(rawId)) return String(rawId);
    return createNoteId();
  }

  // Elementos del DOM
  const notesGrid = document.getElementById('notesGrid');
  const modalToggle = document.getElementById('edit-modal-toggle');
  const newNoteBtn = document.getElementById('newNoteBtn');
  const noteForm = document.getElementById('noteForm');
  const titleInput = document.getElementById('title');
  const contentInput = document.getElementById('content');
  const categoryInputs = document.querySelectorAll('input[name="category"]');
  const modalTitle = document.getElementById('modal-title');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const chatMessages = document.getElementById('chatMessages');

  // Estado: id de nota que estamos editando (null = nueva nota)
  let editingId = null;
  let notesChannel = null;
  let refreshTimer = null;
  let renderInFlight = false;

  function mapSupabaseNote(note){
    return {
      ...note,
      id: normalizeNoteId(note),
      title: note.titulo ?? note.title ?? '',
      body: note.contenido ?? note.body ?? '',
      category: note.category || '',
      date: note.date ?? 'Hoy'
    };
  }

  async function refreshNotes(){
    if(renderInFlight) return;
    renderInFlight = true;
    try{
      await renderNotes();
    } catch(err){
      console.error('Error al refrescar notas:', err);
    } finally{
      renderInFlight = false;
    }
  }

  function startPolling(){
    if(refreshTimer) return;
    refreshTimer = window.setInterval(() => {
      refreshNotes().catch(err => console.error('Error al refrescar notas:', err));
    }, 2500);
  }

  function setupRealtimeSync(){
    startPolling();

    if(notesChannel) return;

    notesChannel = supabase.channel('notes-updates');

    notesChannel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: TABLE_NAME
    }, () => {
      console.info('Cambio detectado en Supabase, refrescando lista');
      refreshNotes();
    });

    notesChannel.subscribe((status) => {
      if(status === 'SUBSCRIBED'){
        console.info('Sincronización en tiempo real activada');
      } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
        console.warn('Realtime no disponible; activando refresco periódico');
      }
    });
  }

  function stopRealtimeSync(){
    if(notesChannel){
      supabase.removeChannel(notesChannel);
      notesChannel = null;
    }
    if(refreshTimer){
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // Cargar notas desde Supabase o usar ejemplos
  async function loadNotes(){
    try{
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .order('id', { ascending: false });

      if(error) throw error;
      if(!data || data.length === 0) return getSampleNotes();
      return data.map(mapSupabaseNote);
    }catch(e){
      console.error('Error leyendo notas:', e);
      return getSampleNotes();
    }
  }

  async function saveNotes(notes){
    try{
      const normalized = notes.map(note => ({
        id: normalizeNoteId(note),
        titulo: note.title ?? '',
        contenido: note.body ?? '',
        creada_en: note.creada_en ?? new Date().toISOString(),
        modificada_en: note.modificada_en ?? new Date().toISOString()
      }));

      const { data: existingRows, error: listError } = await supabase
        .from(TABLE_NAME)
        .select('id');

      if(listError) throw listError;

      const incomingIds = new Set((notes || []).map(note => normalizeNoteId(note)));
      const toDelete = (existingRows || [])
        .map(row => String(row.id))
        .filter(id => !incomingIds.has(id));

      if(toDelete.length > 0){
        const { error: deleteError } = await supabase
          .from(TABLE_NAME)
          .delete()
          .in('id', toDelete);
        if(deleteError) throw deleteError;
      }

      const { error: upsertError } = await supabase
        .from(TABLE_NAME)
        .upsert(normalized, { onConflict: 'id' });

      if(upsertError) throw upsertError;
    }catch(e){
      console.error('Error guardando notas:', e);
      throw e;
    }
  }

  function getSampleNotes(){
    return [
      {id: createNoteId(), title:'Comprar cascos talla M', body:'Son los que más se venden. Pedir reposición al proveedor.', category:'trabajo', date:'Hoy'},
      {id: createNoteId(), title:'Grabar episodio del podcast', body:'Tema: cómo elegir tu primer casco sin morir en el intento.', category:'ideas', date:'Ayer'},
      {id: createNoteId(), title:'Idea para la clase', body:'Apagar el CSS en vivo y que vean los huesos del HTML.', category:'personal', date:'Lunes'}
    ];
  }

  // Renderiza todas las notas en el DOM
  async function renderNotes(){
    const notes = await loadNotes();

    notesGrid.innerHTML = '';

    notes.forEach(note => {
      const article = document.createElement('article');
      article.className = 'note-card';
      article.dataset.id = note.id;

      article.innerHTML = `
        <h2 class="note-title"></h2>
        <p class="note-body"></p>
        <footer class="note-meta">
          <span class="badge"></span>
          <div class="meta-actions" style="margin-left:auto;display:flex;gap:8px;align-items:center"></div>
        </footer>
      `;

      article.querySelector('.note-title').textContent = note.title;
      article.querySelector('.note-body').textContent = note.body;
      article.querySelector('.badge').textContent = note.date || '';

      const actions = article.querySelector('.meta-actions');

      // Edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-outline';
      editBtn.type = 'button';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => openEditor(note));
      actions.appendChild(editBtn);

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.type = 'button';
      delBtn.textContent = 'Borrar';
      delBtn.addEventListener('click', () => removeNote(note.id));
      actions.appendChild(delBtn);

      notesGrid.appendChild(article);
    });
  }

  // Abre el modal para crear una nueva nota o editar una existente
  function openEditor(note){
    if(note){
      editingId = note.id;
      titleInput.value = note.title || '';
      contentInput.value = note.body || '';
      // seleccionar categoría
      categoryInputs.forEach(i => i.checked = (i.value === note.category));
      modalTitle.textContent = 'Editar nota';
    }else{
      editingId = null;
      noteForm.reset();
      modalTitle.textContent = 'Nueva nota';
    }
    // abrir modal (checkbox control)
    modalToggle.checked = true;
    // poner foco en el título
    setTimeout(()=> titleInput.focus(), 100);
  }

  // Cierra el modal y limpia el formulario
  function closeEditor(){
    modalToggle.checked = false;
    noteForm.reset();
    editingId = null;
  }

  // Elimina una nota por id
  async function removeNote(id){
    if(!confirm('¿Eliminar esta nota?')) return;
    const notes = (await loadNotes()).filter(n => n.id !== id);
    await saveNotes(notes);
    await renderNotes();
  }

  // Obtener categoría seleccionada
  function getSelectedCategory(){
    const checked = Array.from(categoryInputs).find(i => i.checked);
    return checked ? checked.value : '';
  }

  // Manejar el submit del formulario (crear o actualizar)
  noteForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const title = titleInput.value.trim();
    const body = contentInput.value.trim();
    const category = getSelectedCategory();
    if(!title && !body){
      alert('Escribe al menos un título o contenido.');
      return;
    }

    const notes = await loadNotes();

    if(editingId){
      // actualizar
      const idx = notes.findIndex(n => n.id === editingId);
      if(idx !== -1){
        notes[idx].title = title;
        notes[idx].body = body;
        notes[idx].category = category;
      }
    }else{
      // nueva nota
      const newNote = {id: createNoteId(), title, body, category, date:'Hoy'};
      notes.unshift(newNote);
    }

    await saveNotes(notes);
    await refreshNotes();
    closeEditor();
  });

  function addChatMessage(role, text){
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function askChatAssistant(question){
    const notes = await loadNotes();
    addChatMessage('user', question);
    const thinking = document.createElement('div');
    thinking.className = 'chat-bubble assistant';
    thinking.textContent = 'Estoy pensando...';
    chatMessages.appendChild(thinking);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try{
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, notes })
      });

      const payload = await response.json();
      thinking.remove();
      if(!response.ok){
        addChatMessage('assistant', payload.error || 'No pude responder.');
        return;
      }
      addChatMessage('assistant', payload.answer || 'Sin respuesta.');
    }catch(err){
      thinking.remove();
      addChatMessage('assistant', 'No se pudo conectar con el asistente.');
      console.error(err);
    }
  }

  chatForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const question = chatInput.value.trim();
    if(!question) return;
    chatInput.value = '';
    await askChatAssistant(question);
  });

  // Abrir modal para nueva nota
  newNoteBtn.addEventListener('click', () => openEditor(null));

  // Inicializar
  setupRealtimeSync();
  window.addEventListener('focus', () => refreshNotes());
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') refreshNotes();
  });
  window.addEventListener('beforeunload', stopRealtimeSync);
  refreshNotes();

})();
