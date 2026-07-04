// scripts.js — Vanilla JS para manejar notas (crear, editar, borrar)
(function(){
  // Clave en localStorage
  const STORAGE_KEY = 'notasapp.notes';

  // Elementos del DOM
  const notesGrid = document.getElementById('notesGrid');
  const modalToggle = document.getElementById('edit-modal-toggle');
  const newNoteBtn = document.getElementById('newNoteBtn');
  const noteForm = document.getElementById('noteForm');
  const titleInput = document.getElementById('title');
  const contentInput = document.getElementById('content');
  const categoryInputs = document.querySelectorAll('input[name="category"]');
  const modalTitle = document.getElementById('modal-title');

  // Estado: id de nota que estamos editando (null = nueva nota)
  let editingId = null;

  // Cargar notas desde localStorage o usar ejemplos
  function loadNotes(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return getSampleNotes();
      return JSON.parse(raw);
    }catch(e){
      console.error('Error leyendo notas:', e);
      return getSampleNotes();
    }
  }

  function saveNotes(notes){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function getSampleNotes(){
    return [
      {id: Date.now()+1, title:'Comprar cascos talla M', body:'Son los que más se venden. Pedir reposición al proveedor.', category:'trabajo', date:'Hoy'},
      {id: Date.now()+2, title:'Grabar episodio del podcast', body:'Tema: cómo elegir tu primer casco sin morir en el intento.', category:'ideas', date:'Ayer'},
      {id: Date.now()+3, title:'Idea para la clase', body:'Apagar el CSS en vivo y que vean los huesos del HTML.', category:'personal', date:'Lunes'}
    ];
  }

  // Renderiza todas las notas en el DOM
  function renderNotes(){
    const notes = loadNotes();
    // Guardar en memoria (persistencia simple)
    saveNotes(notes);

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
  function removeNote(id){
    if(!confirm('¿Eliminar esta nota?')) return;
    const notes = loadNotes().filter(n => n.id !== id);
    saveNotes(notes);
    renderNotes();
  }

  // Obtener categoría seleccionada
  function getSelectedCategory(){
    const checked = Array.from(categoryInputs).find(i => i.checked);
    return checked ? checked.value : '';
  }

  // Manejar el submit del formulario (crear o actualizar)
  noteForm.addEventListener('submit', function(e){
    e.preventDefault();
    const title = titleInput.value.trim();
    const body = contentInput.value.trim();
    const category = getSelectedCategory();
    if(!title && !body){
      alert('Escribe al menos un título o contenido.');
      return;
    }

    const notes = loadNotes();

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
      const newNote = {id: Date.now(), title, body, category, date:'Hoy'};
      notes.unshift(newNote);
    }

    saveNotes(notes);
    renderNotes();
    closeEditor();
  });

  // Abrir modal para nueva nota
  newNoteBtn.addEventListener('click', () => openEditor(null));

  // Inicializar
  renderNotes();

})();
