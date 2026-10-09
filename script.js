// ===== 1. SETUP =====
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Page elements
const library = document.querySelector('.library');
const searchInput = document.getElementById('searchInput');
const pdfPicker = document.getElementById('pdfPicker');
const emptyMessage = document.getElementById('emptyMessage');
const reader = document.getElementById('reader');
const canvas = document.getElementById('pdfCanvas');
const textView = document.getElementById('textView');
const pageInfo = document.getElementById('pageInfo');
const downloadLink = document.getElementById('downloadLink');
const topBar = document.getElementById('topBar');
const bottomBar = document.getElementById('bottomBar');
const menuPanel = document.getElementById('menuPanel');
const pageSlider = document.getElementById('pageSlider');
const progressFill = document.getElementById('progressFill');
const readerTitle = document.getElementById('readerTitle');

// Things that change while the app runs
let db = null;           // the database
let currentBook = null;  // the book being read
let pdfDoc = null;       // the loaded PDF
let currentPage = 1;
let zoom = 1.5;
let fontSize = 18;
let textMode = false;
let renderTask = null;   // the page being drawn right now

// ===== 2. DATABASE =====
function openDatabase() {
    return new Promise(function (resolve, reject) {
        const request = indexedDB.open('bookie', 1);

        request.onupgradeneeded = function () {
            request.result.createObjectStore('books', {
                keyPath: 'id',
                autoIncrement: true
            });
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
    });
}

// One helper that every database action goes through
function run(mode, action) {
    return new Promise(function (resolve, reject) {
        const store = db.transaction('books', mode).objectStore('books');
        const request = action(store);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
    });
}

function saveBook(book) {
    return run('readwrite', function (store) { return store.add(book); });
}

function getAllBooks() {
    return run('readonly', function (store) { return store.getAll(); });
}

function deleteBook(id) {
    return run('readwrite', function (store) { return store.delete(id); });
}

// ===== 3. THE SHELF =====
function fillSlots() {
    // 1. Remove the old empty slots
    library.querySelectorAll('.slot').forEach(function (slot) {
        slot.remove();
    });

    // 2. Count the real books and show or hide the hint message
    const count = library.querySelectorAll('.book').length;
    emptyMessage.style.display = count === 0 ? '' : 'none';

    // 3. Work out how many places the shelf needs
    let total = Math.max(6, count + 1);
    if (total % 2 === 1) {
        total++;
    }

    // 4. Add empty slots to fill the rest
    for (let i = count; i < total; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        library.appendChild(slot);
    }
}

function makeCover(file) {
    return file.arrayBuffer()
        .then(function (data) {
            return pdfjsLib.getDocument({ data: data }).promise;
        })
        .then(function (doc) {
            return doc.getPage(1);
        })
        .then(function (page) {
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: 300 / base.width });

            const small = document.createElement('canvas');
            small.width = viewport.width;
            small.height = viewport.height;

            return page.render({
                canvasContext: small.getContext('2d'),
                viewport: viewport
            }).promise.then(function () {
                return small.toDataURL('image/jpeg', 0.8);
            });
        })
        .catch(function () {
            return null;
        });
}

function makeProgress(book) {
    const page = Number(localStorage.getItem('bookie-page-' + book.id));
    const pages = Number(localStorage.getItem('bookie-pages-' + book.id));

    if (!page || !pages) { return null; }

    const wrap = document.createElement('div');
    wrap.className = 'progress';

    const track = document.createElement('div');
    track.className = 'progress-track';

    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = (page / pages * 100) + '%';

    const label = document.createElement('span');
    label.textContent = 'Page ' + page + ' of ' + pages;

    track.append(fill);
    wrap.append(track, label);
    return wrap;
}

function createCard(book) {
    const card = document.createElement('div');
    card.className = 'book';
    card.dataset.id = book.id;

    if (book.cover) {
        const img = document.createElement('img');
        img.src = book.cover;
        img.alt = book.title;
        card.append(img);
    }

    const title = document.createElement('h3');
    title.textContent = book.title;

    const openButton = document.createElement('button');
    openButton.textContent = 'Open Book';
    openButton.onclick = function (event) {
        reader.style.transformOrigin = event.clientX + 'px ' + event.clientY + 'px';
        openBook(book);
    };

    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove';
    removeButton.className = 'remove';
    removeButton.onclick = function () {
        if (!confirm('Remove "' + book.title + '" from your library?')) {
            return;
        }
        deleteBook(book.id).then(function () {
            localStorage.removeItem('bookie-page-' + book.id);
            localStorage.removeItem('bookie-pages-' + book.id);
            card.remove();
            fillSlots();
        });
    };

    card.append(title);

    const progress = makeProgress(book);
    if (progress) {
        card.append(progress);
    }

    card.append(openButton, removeButton);
    return card;
}

// Adding books with the file picker
pdfPicker.addEventListener('change', function () {
    const files = Array.from(pdfPicker.files);

    files.forEach(function (file) {
        makeCover(file).then(function (cover) {
            const book = {
                title: file.name.replace(/\.pdf$/i, ''),
                file: file,
                cover: cover
            };

            return saveBook(book).then(function (id) {
                book.id = id;
                const card = createCard(book);
card.classList.add('new');
library.appendChild(card);
                fillSlots();
            });
        });
    });

    pdfPicker.value = '';
});

// Search by title
function applyFilters() {
    const query = searchInput.value.toLowerCase();

    document.querySelectorAll('.book').forEach(function (card) {
        const title = card.querySelector('h3').textContent.toLowerCase();
        card.style.display = title.includes(query) ? '' : 'none';
    });
}

searchInput.addEventListener('input', applyFilters);



// ===== 4. THE READER =====
function setControls(show) {
    topBar.classList.toggle('hidden', !show);
    bottomBar.classList.toggle('hidden', !show);
    if (!show) {
        menuPanel.classList.add('hidden');
    }
}

function updatePageInfo() {
    pageInfo.textContent = currentPage + ' of ' + pdfDoc.numPages;
    pageSlider.max = pdfDoc.numPages;
    pageSlider.value = currentPage;
    progressFill.style.width = (currentPage / pdfDoc.numPages * 100) + '%';
}

function openBook(book) {
    currentBook = book;
    const oldCard = library.querySelector('.book[data-id="' + currentBook.id + '"]');
if (oldCard) {
    oldCard.replaceWith(createCard(currentBook));
    applyFilters();
}
    pdfDoc = null;
    textMode = false;
    reader.classList.remove('hidden');
    history.pushState({ reader: true }, '');
    canvas.style.opacity = 0;
    readerTitle.textContent = book.title;
setControls(false);
    pageInfo.textContent = 'Loading...';

    downloadLink.href = URL.createObjectURL(book.file);
    downloadLink.download = book.title + '.pdf';

    book.file.arrayBuffer()
        .then(function (data) {
            return pdfjsLib.getDocument({ data: data }).promise;
        })
        .then(function (doc) {
            pdfDoc = doc;
            pdfDoc = doc;
            localStorage.setItem('bookie-pages-' + book.id, doc.numPages);
            updatePageInfo();
            const saved = Number(localStorage.getItem('bookie-page-' + book.id)) || 1;
            currentPage = Math.min(saved, doc.numPages);
            refresh();
        })
        .catch(function () {
            pageInfo.textContent = 'Could not open this PDF';
        });
}

// Decides which view to draw, and remembers the page
function refresh() {
    if (!pdfDoc) { return; }

    localStorage.setItem('bookie-page-' + currentBook.id, currentPage);
    canvas.style.display = textMode ? 'none' : 'block';
    textView.classList.toggle('hidden', !textMode);

    if (textMode) {
        renderText();
    } else {
        renderPage();
    }
}

function renderPage() {
    pdfDoc.getPage(currentPage).then(function (page) {
        const body = canvas.parentElement;
        const base = page.getViewport({ scale: 1 });
        const fit = body.clientWidth / base.width;
        const viewport = page.getViewport({
            scale: fit * zoom * window.devicePixelRatio
        });

        if (renderTask) { renderTask.cancel(); }

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = (zoom * 100) + '%';

        renderTask = page.render({
            canvasContext: canvas.getContext('2d'),
            viewport: viewport
        });
        renderTask.promise
    .then(function () { canvas.style.opacity = 1; })
    .catch(function () {});

        body.scrollTop = 0;
        body.scrollLeft = (body.scrollWidth - body.clientWidth) / 2;
        
    });
}

function renderText() {
    pdfDoc.getPage(currentPage)
        .then(function (page) {
            return page.getTextContent();
        })
        .then(function (content) {
            const text = content.items
                .map(function (item) { return item.str; })
                .join(' ')
                .trim();

            textView.textContent = text || 'No text found on this page. Switch back to page view.';
            textView.style.fontSize = fontSize + 'px';
            canvas.parentElement.scrollTop = 0;
        });
}

// ===== 5. BUTTONS AND START =====
document.getElementById('menuToggle').addEventListener('click', function () {
    menuPanel.classList.toggle('hidden');
});

pageSlider.addEventListener('input', function () {
    if (!pdfDoc) { return; }
    pageInfo.textContent = pageSlider.value + ' of ' + pdfDoc.numPages;
});

pageSlider.addEventListener('change', function () {
    if (!pdfDoc) { return; }
    currentPage = Number(pageSlider.value);
    refresh();
});

document.getElementById('zoomIn').addEventListener('click', function () {
    if (textMode) {
        fontSize = Math.min(fontSize + 2, 40);
    } else {
        zoom = Math.min(zoom + 0.25, 4);
    }
    refresh();
});

document.getElementById('zoomOut').addEventListener('click', function () {
    if (textMode) {
        fontSize = Math.max(fontSize - 2, 12);
    } else {
        zoom = Math.max(zoom - 0.25, 1);
    }
    refresh();
});

document.getElementById('textToggle').addEventListener('click', function () {
    textMode = !textMode;
    refresh();
});

function closeReader() {
    if (renderTask) { renderTask.cancel(); }
    reader.classList.add('hidden');
    URL.revokeObjectURL(downloadLink.href);
    pdfDoc = null;
}

document.getElementById('closeReader').addEventListener('click', function () {
    history.back();
});

window.addEventListener('popstate', function () {
    if (!reader.classList.contains('hidden')) {
        closeReader();
    }
});

document.querySelector('.reader-body').addEventListener('click', function (event) {
    if (!pdfDoc) { return; }

    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;

    if (x > 0.7) {
        if (currentPage < pdfDoc.numPages) {
            currentPage++;
            refresh();
        }
    } else if (x < 0.3) {
        if (currentPage > 1) {
            currentPage--;
            refresh();
        }
    } else {
        setControls(topBar.classList.contains('hidden'));
    }
});

// ===== Reading themes =====
const themes = ['wood', 'dark', 'sepia', 'light'];
let themeIndex = (Number(localStorage.getItem('bookie-theme')) || 0) % themes.length;

function applyTheme() {
    themes.forEach(function (name) {
        reader.classList.remove('theme-' + name);
    });
    reader.classList.add('theme-' + themes[themeIndex]);
    document.getElementById('themeToggle').textContent = 'Theme: ' + themes[themeIndex];
    localStorage.setItem('bookie-theme', themeIndex);
}

document.getElementById('themeToggle').addEventListener('click', function () {
    themeIndex = (themeIndex + 1) % themes.length;
    applyTheme();
});

applyTheme();

// Start: open the database, then load the saved books onto the shelf
fillSlots();
openDatabase()
    .then(function (database) {
        db = database;
        return getAllBooks();
    })
    .then(function (books) {
        books.forEach(function (book) {
            library.appendChild(createCard(book));
        });
        fillSlots();
    })
    .catch(function () {
        emptyMessage.textContent = 'Storage is not available in this browser.';
    });

// Ask the browser not to delete saved books when space is low
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}
