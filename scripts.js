// scripts.js — Vanilla JS para manejar notas (crear, editar, borrar)
(function(){
  const SUPABASE_URL = 'https://mtbxxaitvrfpoxqjljqh.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_OQ7vnw2f1G7Ut6pO9wJU1w_Qak8akYi';
  const SUPABASE_AUTH_URL = `${SUPABASE_URL}/auth/v1`;
  const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;
  const TABLE_NAME = 'notas';
  const CATEGORY_ID_BY_LABEL = { trabajo: 1, ideas: 2, personal: 3 };
  const LABEL_BY_CATEGORY_ID = { 1: 'trabajo', 2: 'ideas', 3: 'personal' };
  const LOCAL_AUTH_SESSION_KEY = 'notasapp.localSession';
  const LOCAL_SUPABASE_SESSION_KEY = 'notasapp.supabaseSession';
  const LOCAL_USERS_STORAGE_KEY = 'notasapp.localUsers';
  const LOCAL_NOTES_PREFIX = 'notasapp.notes.';
  const REFRESH_INTERVAL_MS = 15000;

  let supabase = null;
  if(window.supabase){
    try{
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }catch(error){
      console.warn('No se pudo inicializar Supabase:', error?.message || error);
    }
  }

  let currentSession = null;
  let isRegisterMode = false;

  function getLocalUsers(){
    try{
      const raw = window.localStorage.getItem(LOCAL_USERS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(error){
      console.warn('No se pudieron leer usuarios locales:', error);
      return [];
    }
  }

  function saveLocalUsers(users){
    window.localStorage.setItem(LOCAL_USERS_STORAGE_KEY, JSON.stringify(users));
  }

  function getStoredLocalUser(email){
    const normalized = String(email || '').trim().toLowerCase();
    return getLocalUsers().find(user => (user.email || '').toLowerCase() === normalized) || null;
  }

  function registerLocalUser(email, password){
    const users = getLocalUsers();
    if(getStoredLocalUser(email)) throw new Error('Ya existe una cuenta local con ese correo.');
    const user = { id: createNoteId(), email: String(email).trim().toLowerCase(), password, createdAt: new Date().toISOString() };
    users.push(user);
    saveLocalUsers(users);
    return user;
  }

  function loginLocalUser(email, password){
    const user = getStoredLocalUser(email);
    if(!user || user.password !== password) throw new Error('Correo o contraseña incorrectos.');
    return user;
  }

  function getLocalSession(){
    try{
      const raw = window.localStorage.getItem(LOCAL_AUTH_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(error){
      return null;
    }
  }

  function persistLocalSession(user){
    const session = { provider: 'local', user: { id: user.id, email: user.email } };
    window.localStorage.setItem(LOCAL_AUTH_SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearLocalSession(){
    window.localStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
  }

  function getSupabaseSession(){
    try{
      const raw = window.localStorage.getItem(LOCAL_SUPABASE_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(error){
      return null;
    }
  }

  function persistSupabaseSession(session){
    window.localStorage.setItem(LOCAL_SUPABASE_SESSION_KEY, JSON.stringify(session));
  }

  function clearSupabaseSession(){
    window.localStorage.removeItem(LOCAL_SUPABASE_SESSION_KEY);
  }

  async function signUpSupabase(email, password){
    if(!supabase?.auth) throw new Error('Supabase no disponible');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if(error) throw error;
    return {
      session: data.session ? { ...data.session, provider: 'supabase' } : null,
      user: data.user || null,
      error: null
    };
  }

  async function signInSupabase(email, password){
    if(!supabase?.auth) throw new Error('Supabase no disponible');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) throw error;
    return {
      session: data.session ? { ...data.session, provider: 'supabase' } : null,
      user: data.user || null,
      error: null
    };
  }

  async function loadNotesFromSupabase(userId){
    if(!supabase?.from) throw new Error('Supabase no disponible');
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('user_id', userId)
      .order('id', { ascending: false });
    if(error) throw error;
    return (data || []).map(mapSupabaseNote);
  }

  async function saveNotesToSupabase(notes, userId){
    if(!supabase?.from) throw new Error('Supabase no disponible');
    const normalized = notes.map(note => ({
      id: normalizeNoteId(note),
      titulo: note.title ?? '',
      contenido: note.body ?? '',
      category: note.category ?? '',
      creada_en: note.creada_en ?? new Date().toISOString(),
      modificada_en: new Date().toISOString(),
      user_id: userId
    }));

    const { data: existingRows, error: listError } = await supabase
      .from(TABLE_NAME)
      .select('id')
      .eq('user_id', userId);

    if(listError) throw listError;

    const incomingIds = new Set(normalized.map(note => normalizeNoteId(note)));
    const toDelete = (existingRows || [])
      .map(row => String(row.id))
      .filter(id => !incomingIds.has(id));

    if(toDelete.length > 0){
      const { error: deleteError } = await supabase
        .from(TABLE_NAME)
        .delete()
        .in('id', toDelete)
        .eq('user_id', userId);
      if(deleteError) throw deleteError;
    }

    const { error: upsertError } = await supabase
      .from(TABLE_NAME)
      .upsert(normalized, { onConflict: 'id' });

    if(upsertError) throw upsertError;
  }

  function getLocalNotesKey(userId){
    return `${LOCAL_NOTES_PREFIX}${userId}`;
  }

  function loadNotesFromLocalStorage(userId){
    if(!userId) return [];
    try{
      const raw = window.localStorage.getItem(getLocalNotesKey(userId));
      return raw ? JSON.parse(raw) : [];
    }catch(error){
      console.warn('No se pudieron cargar notas locales:', error);
      return [];
    }
  }

  function saveNotesToLocalStorage(notes, userId){
    if(!userId) return;
    window.localStorage.setItem(getLocalNotesKey(userId), JSON.stringify(notes));
  }

  function getFriendlyAuthMessage(error){
    const code = error?.code || error?.status || '';
    const message = error?.message || '';
    if(code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || message.includes('rate limit')){
      return 'Se han enviado demasiados correos de confirmación. Espera unos minutos o prueba con otro correo.';
    }
    if(code === 'invalid_credentials' || message.includes('Invalid login credentials')){
      return 'Correo o contraseña incorrectos.';
    }
    if(code === 'email_address_invalid' || message.includes('invalid email')){
      return 'Introduce un correo válido.';
    }
    if(message.includes('fetch')){
      return 'No se pudo conectar con el servicio de autenticación.';
    }
    return message || 'No se pudo completar la autenticación.';
  }

  const authSection = document.getElementById('authSection');
  const appSection = document.getElementById('appSection');
  const authForm = document.getElementById('authForm');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authMessage = document.getElementById('authMessage');
  const authTitle = document.getElementById('authTitle');
  const authToggleText = document.getElementById('authToggleText');
  const toggleRegisterBtn = document.getElementById('toggleRegisterBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userEmailSpan = document.getElementById('userEmail');

  function setAuthView(isLoggedIn){
    authSection.classList.toggle('hidden', isLoggedIn);
    appSection.classList.toggle('hidden', !isLoggedIn);
    newNoteBtn.classList.toggle('hidden', !isLoggedIn);
    logoutBtn.classList.toggle('hidden', !isLoggedIn);
    userEmailSpan.classList.toggle('hidden', !isLoggedIn);
  }

  function updateAuthUi(session){
    const user = session?.user;
    const signedIn = !!user;

    if(signedIn){
      authTitle.textContent = 'Bienvenido';
      authMessage.textContent = `Conectado como ${user.email || 'usuario'}.`;
      userEmailSpan.textContent = user.email || 'Usuario';
    } else {
      authTitle.textContent = isRegisterMode ? 'Crear cuenta' : 'Iniciar sesión';
      authMessage.textContent = isRegisterMode
        ? 'Regístrate con email y contraseña.'
        : 'Accede para ver tu cuaderno privado.';
      userEmailSpan.textContent = '';
    }

    authForm.querySelector('button[type="submit"]').textContent = isRegisterMode ? 'Crear cuenta' : 'Entrar';
    authToggleText.textContent = isRegisterMode ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
    toggleRegisterBtn.textContent = isRegisterMode ? 'Inicia sesión' : 'Regístrate';
    setAuthView(signedIn);
  }

  async function initAuth(){
    const localSession = getLocalSession();
    if(localSession?.user){
      currentSession = localSession;
      updateAuthUi(currentSession);
      await refreshNotes();
      return;
    }

    if(supabase?.auth){
      try{
        const { data } = await supabase.auth.getSession();
        const session = data.session ? { ...data.session, provider: 'supabase' } : null;
        if(session?.user){
          currentSession = session;
          persistSupabaseSession(session);
          updateAuthUi(currentSession);
          await refreshNotes();
          return;
        }
      }catch(error){
        console.warn('No se pudo restaurar la sesión de Supabase:', error?.message || error);
      }
    }

    currentSession = null;
    updateAuthUi(currentSession);
  }

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
    }, REFRESH_INTERVAL_MS);
  }

  function setupRealtimeSync(){
    if(currentSession?.provider === 'local') return;
    startPolling();

    if(notesChannel || !supabase?.channel) return;

    notesChannel = supabase.channel('notes-updates');
    notesChannel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: TABLE_NAME
    }, () => {
      refreshNotes();
    });

    notesChannel.subscribe();
  }

  function stopRealtimeSync(){
    if(notesChannel && supabase?.removeChannel){
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
      const session = currentSession || getLocalSession() || getSupabaseSession();
      if(!session?.user) return [];

      if(session.provider === 'local'){
        return (loadNotesFromLocalStorage(session.user.id) || []).map(mapSupabaseNote);
      }

      const userId = session.user.id;
      try{
        return await loadNotesFromSupabase(userId);
      }catch(error){
        console.warn('No se pudieron leer notas de Supabase, usando respaldo local:', error.message || error);
        return (loadNotesFromLocalStorage(userId) || []).map(mapSupabaseNote);
      }
    }catch(e){
      console.error('Error leyendo notas:', e);
      return [];
    }
  }

  async function saveNotes(notes){
    try{
      const session = currentSession || getLocalSession() || getSupabaseSession();
      if(!session?.user) throw new Error('Usuario no autenticado.');

      if(session.provider === 'local'){
        saveNotesToLocalStorage(notes, session.user.id);
        return;
      }

      const userId = session.user.id;
      try{
        await saveNotesToSupabase(notes, userId);
        saveNotesToLocalStorage(notes, userId);
      }catch(error){
        console.warn('No se pudieron guardar notas en Supabase, usando respaldo local:', error.message || error);
        saveNotesToLocalStorage(notes, userId);
      }
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
        const friendlyMessage = response.status === 429
          ? 'El asistente está temporalmente saturado. Prueba otra vez en unos segundos.'
          : (payload.error || 'No pude responder.');
        addChatMessage('assistant', friendlyMessage);
        return;
      }
      addChatMessage('assistant', payload.answer || 'Sin respuesta.');
    }catch(err){
      thinking.remove();
      addChatMessage('assistant', 'No se pudo conectar con el asistente en este momento.');
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

  // Login / registro
  authForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const email = authEmail.value.trim().toLowerCase();
    const password = authPassword.value;

    if(!email || !password){
      alert('Completa email y contraseña.');
      return;
    }

    authMessage.textContent = 'Procesando...';

    try{
      if(isRegisterMode){
        try{
          const result = await signUpSupabase(email, password);
          if(result.session){
            persistSupabaseSession(result.session);
            currentSession = result.session;
            updateAuthUi(currentSession);
            await refreshNotes();
            return;
          }
        }catch(error){
          const message = getFriendlyAuthMessage(error);
          authMessage.textContent = message;
          const localUser = registerLocalUser(email, password);
          currentSession = persistLocalSession(localUser);
          updateAuthUi(currentSession);
          await refreshNotes();
          return;
        }

        const localUser = registerLocalUser(email, password);
        currentSession = persistLocalSession(localUser);
        updateAuthUi(currentSession);
        authMessage.textContent = 'Cuenta creada localmente. Ya puedes entrar en este dispositivo.';
        await refreshNotes();
      } else {
        const localUser = getStoredLocalUser(email);
        if(localUser && localUser.password === password){
          currentSession = persistLocalSession(localUser);
          updateAuthUi(currentSession);
          authMessage.textContent = 'Sesión iniciada localmente.';
          await refreshNotes();
          return;
        }

        try{
          const result = await signInSupabase(email, password);
          if(result.session){
            persistSupabaseSession(result.session);
            currentSession = result.session;
            updateAuthUi(currentSession);
            await refreshNotes();
            return;
          }
        }catch(error){
          const message = getFriendlyAuthMessage(error);
          authMessage.textContent = message;
          alert(message);
          return;
        }

        authMessage.textContent = 'No se pudo conectar con el servicio de autenticación. Inténtalo de nuevo en unos minutos.';
        alert('No se pudo conectar con el servicio de autenticación. Inténtalo de nuevo en unos minutos.');
        return;
      }
    }catch(err){
      console.warn('Error de autenticación:', err?.message || err);
      authMessage.textContent = getFriendlyAuthMessage(err);
      alert(getFriendlyAuthMessage(err));
    }
  });

  toggleRegisterBtn.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    updateAuthUi(currentSession);
    authPassword.autocomplete = isRegisterMode ? 'new-password' : 'current-password';
  });

  logoutBtn.addEventListener('click', async () => {
    clearSupabaseSession();
    clearLocalSession();
    currentSession = null;
    updateAuthUi(currentSession);
    stopRealtimeSync();
  });

  // Abrir modal para nueva nota
  newNoteBtn.addEventListener('click', () => openEditor(null));

  // Inicializar
  initAuth();
  window.addEventListener('focus', () => {
    if(!appSection.classList.contains('hidden')) refreshNotes();
  });
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && !appSection.classList.contains('hidden')) refreshNotes();
  });
  window.addEventListener('beforeunload', stopRealtimeSync);

})();
