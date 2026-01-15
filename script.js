// ============================================================================
// GLOBAL STATE
// ============================================================================
let pyodide = null;
let selectedFiles = [];
let selectedImages = [];
let signatureFile = null;
let editImageFile = null;
let extractedText = '';
let convertedImages = [];
let ocrExtractedText = '';

// ============================================================================
// INITIALIZATION
// ============================================================================
window.addEventListener('load', () => {
    initPyodide();
    initTesseract();
    setupEventListeners();
    initUploadHandlers();
    initTabs();
});

async function initPyodide() {
    try {
        updateStatus('Loading Pyodide runtime...');
        pyodide = await loadPyodide({
            indexURL: './lib/pyodide/',
        });

        updateStatus('Loading Packages...');
        await pyodide.loadPackage(['./lib/pyodide/micropip-0.10.1-py3-none-any.whl', './lib/pyodide/pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl', './lib/pyodide/pillow-11.3.0-cp313-cp313-pyodide_2025_0_wasm32.whl', './lib/pyodide/numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl']);

        updateStatus('Installing OpenCV...');
        await pyodide.runPythonAsync(`
            import micropip
            await micropip.install('./lib/pyodide/opencv_python-4.11.0.86-cp313-cp313-pyodide_2025_0_wasm32.whl')
        `);

        updateStatus('Initializing environment...');
        await pyodide.runPythonAsync(getFallbackPythonCode());

        updateStatus('Ready!', 'success');
        setTimeout(() => document.getElementById('status').style.display = 'none', 2000);
        enableButtons();
    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
        console.error('Pyodide initialization failed:', error);
    }
}

function getFallbackPythonCode() {
    return `
import sys
import io
import base64
import pymupdf as fitz
from PIL import Image
import numpy as np
import cv2
import os

temp_dir = '/tmp/pdf_processor'
os.makedirs(temp_dir, exist_ok=True)

# Global variables for OCR helper
current_doc = None

def open_doc_for_ocr(path):
    global current_doc
    if current_doc: 
        current_doc.close()
    current_doc = fitz.open(path)
    return len(current_doc)

def get_page_for_ocr(index):
    global current_doc
    if not current_doc or index >= len(current_doc):
        return {"type": "error", "data": "Invalid page"}
        
    page = current_doc[index]
    
    # 1. Attempt Native Extraction
    text = page.get_text()
    
    # If substantial text exists, return it (Fast path)
    if len(text.strip()) > 30:
        return {"type": "text", "data": text}
    
    # 2. Scanned Page Detected - Prepare for OCR
    pix = page.get_pixmap(dpi=300)
    
    img_array = np.frombuffer(pix.samples, dtype=np.uint8)
    
    if pix.n >= 3:
        img = img_array.reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            gray = cv2.cvtColor(img, cv2.COLOR_RGBA2GRAY)
        else:
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array.reshape(pix.height, pix.width)

    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    success, encoded_img = cv2.imencode('.png', thresh)
    
    if not success:
        return {"type": "error", "data": "Image encoding failed"}
        
    return {"type": "image", "data": encoded_img.tobytes()}

def close_ocr_doc():
    global current_doc
    if current_doc:
        current_doc.close()
        current_doc = None
    `;
}

// ============================================================================
// UI UTILITIES
// ============================================================================
function updateStatus(message, type = 'info') {
    const status = document.getElementById('status');
    if (!status) return;
    
    if (type === 'info') {
        status.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
        status.style.color = 'var(--text-muted)';
    } else if (type === 'success') {
        status.innerHTML = `<span>✓ ${message}</span>`;
        status.style.color = 'var(--success)';
    } else if (type === 'error') {
        status.innerHTML = `<span>✗ ${message}</span>`;
        status.style.color = 'var(--error)';
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function enableButtons() {
    document.querySelectorAll('button[id$="Btn"]').forEach(btn => {
        btn.disabled = false;
    });
}

function setProgress(percent, labelText = null) {
    const container = document.getElementById('progressContainer');
    const fill = document.getElementById('progressFill');
    const label = document.getElementById('progressPercent');
    const textLabel = container.querySelector('.progress-label span:first-child');
    
    if (labelText) textLabel.textContent = labelText;
    
    container.classList.add('show');
    fill.style.width = percent + '%';
    label.textContent = Math.round(percent) + '%';
}

function hideProgress() {
    setTimeout(() => {
        document.getElementById('progressContainer').classList.remove('show');
        document.querySelector('.progress-container .progress-label span:first-child').textContent = 'Processing...';
    }, 500);
}

// ============================================================================
// TAB MANAGEMENT
// ============================================================================
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons
            tabButtons.forEach(b => b.classList.remove('active'));
            
            // Add active class to clicked button
            btn.classList.add('active');
            
            // Switch tab content
            switchTab(btn.dataset.tab);
        });
    });
}

function switchTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(`${tabId}-tab`);
    if (selectedTab) {
        selectedTab.classList.add('active');
        selectedTab.style.display = 'block';
    }
    
    // Toggle main upload visibility
    const mainUpload = document.getElementById('mainUploadSection');
    if (tabId === 'img2pdf') {
        mainUpload.style.display = 'none';
    } else {
        mainUpload.style.display = 'block';
    }
}

// ============================================================================
// FILE UPLOAD HANDLERS
// ============================================================================
function initUploadHandlers() {
    // Main PDF upload
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    if (uploadArea && fileInput) {
        uploadArea.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-active');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-active');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-active');
            const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
            if (files.length === 0) {
                showToast('Please drop PDF files', 'error');
                return;
            }
            selectedFiles = [...selectedFiles, ...files];
            renderFileList();
        });

        fileInput.addEventListener('change', (e) => {
            selectedFiles = [...selectedFiles, ...Array.from(e.target.files)];
            renderFileList();
        });
    }
    
    // Image to PDF upload
    const imgToPdfArea = document.getElementById('imgToPdfArea');
    const imgToPdfInput = document.getElementById('imgToPdfInput');
    
    if (imgToPdfArea && imgToPdfInput) {
        imgToPdfArea.addEventListener('click', () => imgToPdfInput.click());
        
        imgToPdfArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            imgToPdfArea.classList.add('drag-active');
        });
        
        imgToPdfArea.addEventListener('dragleave', () => {
            imgToPdfArea.classList.remove('drag-active');
        });
        
        imgToPdfArea.addEventListener('drop', (e) => {
            e.preventDefault();
            imgToPdfArea.classList.remove('drag-active');
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length === 0) {
                showToast('Please drop image files', 'error');
                return;
            }
            selectedImages = [...selectedImages, ...files];
            renderImgList();
        });

        imgToPdfInput.addEventListener('change', (e) => {
            selectedImages = [...selectedImages, ...Array.from(e.target.files)];
            renderImgList();
        });
    }
    
    // Signature upload
    const signArea = document.getElementById('signArea');
    const signInput = document.getElementById('signInput');
    
    if (signArea && signInput) {
        signArea.addEventListener('click', () => signInput.click());
        
        signArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            signArea.classList.add('drag-active');
        });
        
        signArea.addEventListener('dragleave', () => {
            signArea.classList.remove('drag-active');
        });
        
        signArea.addEventListener('drop', (e) => {
            e.preventDefault();
            signArea.classList.remove('drag-active');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                signatureFile = file;
                document.getElementById('signFileName').textContent = file.name;
            }
        });
        
        signInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                signatureFile = e.target.files[0];
                document.getElementById('signFileName').textContent = signatureFile.name;
            }
        });
        
        // Show/hide custom coordinates for signature
        const signPosition = document.getElementById('signPosition');
        if (signPosition) {
            signPosition.addEventListener('change', (e) => {
                const custom = document.getElementById('customSignCoords');
                if (e.target.value === 'custom') {
                    custom.classList.remove('hidden');
                } else {
                    custom.classList.add('hidden');
                }
            });
        }
    }
    
    // Edit image upload
    const editImgArea = document.getElementById('editImgArea');
    const editImgInput = document.getElementById('editImgInput');
    
    if (editImgArea && editImgInput) {
        editImgArea.addEventListener('click', () => editImgInput.click());
        editImgInput.addEventListener('change', (e) => {
            editImageFile = e.target.files[0];
            if (editImageFile) {
                document.getElementById('editImgName').textContent = editImageFile.name;
            }
        });
    }
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    
    fileList.innerHTML = '';
    selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-item-info">
                <div class="file-item-icon">📄</div>
                <div class="file-item-details">
                    <div class="file-item-name">${file.name}</div>
                    <div class="file-item-size">${(file.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
            </div>
            <button class="file-item-remove" onclick="removeFile(${index})">✕</button>
        `;
        fileList.appendChild(item);
    });
}

function renderImgList() {
    const imgList = document.getElementById('imgList');
    if (!imgList) return;
    
    imgList.innerHTML = '';
    selectedImages.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-item-info">
                <div class="file-item-icon">📷</div>
                <div class="file-item-details">
                    <div class="file-item-name">${file.name}</div>
                </div>
            </div>
            <button class="file-item-remove" onclick="removeImage(${index})">✕</button>
        `;
        imgList.appendChild(item);
    });
}

// ============================================================================
// GLOBAL REMOVE FUNCTIONS
// ============================================================================
window.removeFile = (index) => {
    selectedFiles.splice(index, 1);
    renderFileList();
};

window.removeImage = (index) => {
    selectedImages.splice(index, 1);
    renderImgList();
};

// ============================================================================
// EVENT LISTENER SETUP
// ============================================================================
function setupEventListeners() {
    // Extract Text
    document.getElementById('extractBtn')?.addEventListener('click', extractTextOperation);
    
    // Convert to Images
    document.getElementById('convertBtn')?.addEventListener('click', convertToImagesOperation);
    
    // Compress PDF
    document.getElementById('compressBtn')?.addEventListener('click', compressPDFOperation);
    
    // Merge PDFs
    document.getElementById('mergeBtn')?.addEventListener('click', mergePDFsOperation);
    
    // Split PDF
    document.getElementById('splitBtn')?.addEventListener('click', splitPDFOperation);
    
    // Rotate Pages
    document.getElementById('rotateBtn')?.addEventListener('click', rotatePagesOperation);
    
    // Delete Pages
    document.getElementById('deleteBtn')?.addEventListener('click', deletePagesOperation);
    
    // Insert Pages
    document.getElementById('insertBtn')?.addEventListener('click', insertPagesOperation);
    
    // Encrypt PDF
    document.getElementById('encryptBtn')?.addEventListener('click', encryptPDFOperation);
    
    // Decrypt PDF
    document.getElementById('decryptBtn')?.addEventListener('click', decryptPDFOperation);
    
    // Add Text to PDF
    document.getElementById('addTextBtn')?.addEventListener('click', addTextToPDFOperation);
    
    // Add Image to PDF
    document.getElementById('addImgBtn')?.addEventListener('click', addImageToPDFOperation);
    
    // OCR
    document.getElementById('ocrBtn')?.addEventListener('click', runOCROperation);
    
    // Image to PDF
    document.getElementById('imgToPdfBtn')?.addEventListener('click', imgToPDFOperation);
    
    // Add Page Numbers
    document.getElementById('numberBtn')?.addEventListener('click', addPageNumbersOperation);
    
    // Sign PDF
    document.getElementById('signBtn')?.addEventListener('click', signPDFOperation);
    
    // Add Watermark
    document.getElementById('watermarkBtn')?.addEventListener('click', addWatermarkOperation);
    
    // Get Metadata
    document.getElementById('metadataBtn')?.addEventListener('click', getMetadataOperation);
    
    // Download Text
    document.getElementById('downloadTextBtn')?.addEventListener('click', downloadText);
    
    // Download OCR Text
    document.getElementById('downloadOcrBtn')?.addEventListener('click', downloadOCRText);
}

// ============================================================================
// PDF OPERATIONS
// ============================================================================
async function extractTextOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const fs = pyodide.FS;
        const filename = `/tmp/pdf_processor/extract_${Date.now()}.pdf`;
        fs.writeFile(filename, bytes);

        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${filename}')
text = ""
for page in doc:
    text += page.get_text() + "\\n"
doc.close()
text
        `;
        
        setProgress(60);
        extractedText = await pyodide.runPythonAsync(pythonCode);
        fs.unlink(filename);
        
        setProgress(100);
        hideProgress();
        
        document.getElementById('textOutput').textContent = extractedText;
        document.getElementById('extractOutput').classList.add('show');
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function convertToImagesOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const fs = pyodide.FS;
        const filename = `/tmp/pdf_processor/imgs_${Date.now()}.pdf`;
        fs.writeFile(filename, bytes);

        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${filename}')
data = []
for page in doc:
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    data.append(pix.tobytes('png'))
doc.close()
data
        `;
        
        setProgress(60);
        const result = await pyodide.runPythonAsync(pythonCode);
        convertedImages = result.toJs().map(img => new Uint8Array(img));
        fs.unlink(filename);
        
        setProgress(100);
        hideProgress();

        const grid = document.getElementById('imagesGrid');
        grid.innerHTML = '';
        convertedImages.forEach((imgData, i) => {
            const blob = new Blob([imgData], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            const div = document.createElement('div');
            div.className = 'image-item';
            div.innerHTML = `<img src="${url}">`;
            grid.appendChild(div);
        });
        document.getElementById('imagesOutput').classList.add('show');
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function compressPDFOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }

    const dpi = document.getElementById('compressDpi')?.value || 72;
    const quality = document.getElementById('compressQuality')?.value || 70;

    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/comp_in_${Date.now()}.pdf`;
        const outFile = `/tmp/pdf_processor/comp_out_${Date.now()}.pdf`;
        fs.writeFile(inFile, bytes);

        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
out_doc = fitz.open()

for page in doc:
    pix = page.get_pixmap(dpi=${dpi})
    img_data = pix.tobytes("jpg", jpg_quality=${quality})
    new_page = out_doc.new_page(width=page.rect.width, height=page.rect.height)
    new_page.insert_image(new_page.rect, stream=img_data)

out_doc.save('${outFile}')
out_doc.close()
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compressed_${file.name}`;
        a.click();
        
        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
        showToast('Compressed PDF Downloaded');
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
        console.error(e);
    }
}

async function mergePDFsOperation() {
    if (selectedFiles.length < 2) {
        showToast('Select 2+ PDFs', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const fs = pyodide.FS;
        const filePaths = [];
        
        for(let i = 0; i < selectedFiles.length; i++) {
            const buf = await selectedFiles[i].arrayBuffer();
            const path = `/tmp/pdf_processor/merge_${i}.pdf`;
            fs.writeFile(path, new Uint8Array(buf));
            filePaths.push(path);
        }
        
        const pythonCode = `
import pymupdf as fitz
out_doc = fitz.open()
for f in ${JSON.stringify(filePaths)}:
    with fitz.open(f) as doc:
        out_doc.insert_pdf(doc)
out_doc.save('/tmp/pdf_processor/merged.pdf')
out_doc.close()
        `;
        
        setProgress(70);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile('/tmp/pdf_processor/merged.pdf');
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'merged.pdf';
        a.click();
        
        filePaths.forEach(f => fs.unlink(f));
        fs.unlink('/tmp/pdf_processor/merged.pdf');
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function splitPDFOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buf = await file.arrayBuffer();
        const fs = pyodide.FS;
        fs.writeFile('/tmp/pdf_processor/split.pdf', new Uint8Array(buf));
        
        const pythonCode = `
import pymupdf as fitz
import os
doc = fitz.open('/tmp/pdf_processor/split.pdf')
files = []
for i in range(len(doc)):
    new_doc = fitz.open()
    new_doc.insert_pdf(doc, from_page=i, to_page=i)
    fname = f'/tmp/pdf_processor/page_{i+1}.pdf'
    new_doc.save(fname)
    new_doc.close()
    files.append(fname)
doc.close()
files
        `;
        
        setProgress(50);
        const result = await pyodide.runPythonAsync(pythonCode);
        const paths = result.toJs();
        
        // Download each
        for(const p of paths) {
            const data = fs.readFile(p);
            const blob = new Blob([data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = p.split('/').pop();
            a.click();
            fs.unlink(p);
            await new Promise(r => setTimeout(r, 200));
        }
        fs.unlink('/tmp/pdf_processor/split.pdf');
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function rotatePagesOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const pages = document.getElementById('rotatePages').value;
    const angle = parseInt(document.getElementById('rotateAngle').value);
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/rot_in.pdf`;
        const outFile = `/tmp/pdf_processor/rot_out.pdf`;
        fs.writeFile(inFile, new Uint8Array(buffer));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
pages_str = '${pages}'
angle = ${angle}

if pages_str.lower() == 'all':
    page_list = range(len(doc))
else:
    page_list = []
    for part in pages_str.split(','):
        if '-' in part:
            start, end = map(int, part.split('-'))
            page_list.extend(range(start-1, end))
        else:
            page_list.append(int(part)-1)

for p_idx in page_list:
    if 0 <= p_idx < len(doc):
        page = doc[p_idx]
        page.set_rotation((page.rotation + angle) % 360)

doc.save('${outFile}')
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rotated_' + file.name;
        a.click();
        
        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function deletePagesOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const pages = document.getElementById('deletePages').value;
    if (!pages) {
        showToast('Enter pages to delete', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/del_in.pdf`;
        const outFile = `/tmp/pdf_processor/del_out.pdf`;
        fs.writeFile(inFile, new Uint8Array(buffer));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
pages_str = '${pages}'

page_list = []
for part in pages_str.split(','):
    if '-' in part:
        start, end = map(int, part.split('-'))
        page_list.extend(range(start-1, end))
    else:
        page_list.append(int(part)-1)

# Delete in reverse to maintain indices
for p_idx in sorted(page_list, reverse=True):
    if 0 <= p_idx < len(doc):
        doc.delete_page(p_idx)

doc.save('${outFile}')
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pages_deleted_' + file.name;
        a.click();
        
        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function insertPagesOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const after = parseInt(document.getElementById('insertAfter').value);
    const count = parseInt(document.getElementById('insertCount').value);
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/ins_in.pdf`;
        const outFile = `/tmp/pdf_processor/ins_out.pdf`;
        fs.writeFile(inFile, new Uint8Array(buffer));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
after = ${after}
count = ${count}

for _ in range(count):
    doc.new_page(pno=after)

doc.save('${outFile}')
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pages_inserted_' + file.name;
        a.click();
        
        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function encryptPDFOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const password = document.getElementById('encryptPassword').value;
    if (!password) {
        showToast('Enter a password', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/enc_in.pdf`;
        const outFile = `/tmp/pdf_processor/enc_out.pdf`;
        fs.writeFile(inFile, new Uint8Array(buffer));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
perm = fitz.PDF_PERM_ACCESSIBILITY | fitz.PDF_PERM_PRINT | fitz.PDF_PERM_COPY | fitz.PDF_PERM_ANNOTATE
doc.save('${outFile}', encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='${password}', user_pw='${password}', permissions=perm)
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'encrypted_' + file.name;
        a.click();
        
        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function decryptPDFOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const password = document.getElementById('decryptPassword').value;
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/dec_in.pdf`;
        const outFile = `/tmp/pdf_processor/dec_out.pdf`;
        fs.writeFile(inFile, new Uint8Array(buffer));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
if doc.is_encrypted:
    success = doc.authenticate('${password}')
    if not success:
        raise Exception("Incorrect password")

doc.save('${outFile}')
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'decrypted_' + file.name;
        a.click();
        
        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function addTextToPDFOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const text = document.getElementById('editText').value;
    const pageNum = parseInt(document.getElementById('editPage').value) - 1;
    const x = parseInt(document.getElementById('editX').value);
    const y = parseInt(document.getElementById('editY').value);
    const size = parseInt(document.getElementById('editSize').value);
    const colorHex = document.getElementById('editColor').value;
    
    // Convert hex to RGB tuple (0-1)
    const r = parseInt(colorHex.slice(1, 3), 16) / 255;
    const g = parseInt(colorHex.slice(3, 5), 16) / 255;
    const b = parseInt(colorHex.slice(5, 7), 16) / 255;

    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/edit_in.pdf`;
        const outFile = `/tmp/pdf_processor/edit_out.pdf`;
        fs.writeFile(inFile, new Uint8Array(buffer));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
if 0 <= ${pageNum} < len(doc):
    page = doc[${pageNum}]
    page.insert_text(fitz.Point(${x}, ${y}), "${text}", fontsize=${size}, color=(${r}, ${g}, ${b}))
doc.save('${outFile}')
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'edited_text_' + file.name;
        a.click();
        
        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function addImageToPDFOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    if (!editImageFile) {
        showToast('Select an image', 'error');
        return;
    }
    
    const pageNum = parseInt(document.getElementById('editImgPage').value) - 1;
    const width = parseInt(document.getElementById('editImgWidth').value);

    try {
        setProgress(10);
        const fs = pyodide.FS;
        const pdfBuf = await selectedFiles[0].arrayBuffer();
        fs.writeFile('/tmp/pdf_processor/edit_img_in.pdf', new Uint8Array(pdfBuf));
        
        const imgBuf = await editImageFile.arrayBuffer();
        const imgExt = editImageFile.name.split('.').pop();
        const imgPath = '/tmp/pdf_processor/edit_img.' + imgExt;
        fs.writeFile(imgPath, new Uint8Array(imgBuf));

        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('/tmp/pdf_processor/edit_img_in.pdf')
if 0 <= ${pageNum} < len(doc):
    page = doc[${pageNum}]
    img = fitz.open('${imgPath}')
    s_rect = img[0].rect
    ratio = s_rect.height / s_rect.width
    img.close()
    
    img_w = ${width}
    img_h = img_w * ratio
    rect = fitz.Rect(50, 50, 50 + img_w, 50 + img_h)
    page.insert_image(rect, filename='${imgPath}')

doc.save('/tmp/pdf_processor/edit_img_out.pdf')
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile('/tmp/pdf_processor/edit_img_out.pdf');
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'edited_img_' + selectedFiles[0].name;
        a.click();
        
        fs.unlink('/tmp/pdf_processor/edit_img_in.pdf');
        fs.unlink('/tmp/pdf_processor/edit_img_out.pdf');
        fs.unlink(imgPath);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

async function runOCROperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    try {
        setProgress(5, 'Preparing document...');
        ocrExtractedText = '';
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const fs = pyodide.FS;
        const filename = `/tmp/pdf_processor/ocr_active.pdf`;
        fs.writeFile(filename, bytes);

        const pageCount = await pyodide.runPythonAsync(`open_doc_for_ocr('${filename}')`);
        
        if (pageCount === 0) {
            showToast('PDF has no pages', 'error');
            hideProgress();
            return;
        }

        document.getElementById('ocrOutput').classList.add('show');
        const outputDiv = document.getElementById('ocrTextOutput');
        outputDiv.textContent = '';

        for (let i = 0; i < pageCount; i++) {
            const progress = Math.round(((i) / pageCount) * 100);
            setProgress(progress, `Processing Page ${i + 1}/${pageCount}...`);
            
            const resultProxy = await pyodide.runPythonAsync(`get_page_for_ocr(${i})`);
            const result = resultProxy.toJs({ dict_converter: Object.fromEntries });
            
            let pageText = "";
            
            if (result.type === 'text') {
                pageText = result.data;
            } else if (result.type === 'image') {
                const blob = new Blob([result.data], { type: 'image/png' });
                
                // Use a worker with local paths for OCR
                const worker = await Tesseract.createWorker('eng', 1, {
                    workerPath: './lib/tesseract/worker.min.js',
                    langPath: './lib/tesseract/lang-data',
                    corePath: './lib/tesseract/tesseract-core.wasm.js',
                    logger: m => console.log(m)
                });
                
                const { data: { text } } = await worker.recognize(blob);
                pageText = text;
                await worker.terminate();
            } else {
                console.error(`Page ${i+1} Error: ${result.data}`);
            }
            
            const formattedText = `--- Page ${i + 1} ---\n${pageText}\n\n`;
            ocrExtractedText += formattedText;
            outputDiv.textContent = ocrExtractedText;
            
            resultProxy.destroy();
        }

        await pyodide.runPythonAsync(`close_ocr_doc()`);
        fs.unlink(filename);
        
        setProgress(100, 'Done!');
        hideProgress();
        
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
        console.error(e);
        try {
            await pyodide.runPythonAsync(`close_ocr_doc()`);
        } catch(err) {
            // Ignore cleanup errors
        }
    }
}

async function imgToPDFOperation() {
    if (selectedImages.length === 0) {
        showToast('Select images first', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const fs = pyodide.FS;
        const imgPaths = [];
        
        for(let i = 0; i < selectedImages.length; i++) {
            const buf = await selectedImages[i].arrayBuffer();
            const path = `/tmp/pdf_processor/img_${i}`;
            const ext = selectedImages[i].name.split('.').pop();
            const fullPath = path + '.' + ext;
            fs.writeFile(fullPath, new Uint8Array(buf));
            imgPaths.push(fullPath);
        }
        
        const pythonCode = `
import pymupdf as fitz
from PIL import Image
from io import BytesIO
import os

# A4 dimensions in pixels
A4_WIDTH_PX = 540
A4_HEIGHT_PX = 720

doc = fitz.open()

for img_path in ${JSON.stringify(imgPaths)}:
    # Open image with PIL to get dimensions and resize
    pil_img = Image.open(img_path)
    
    # Calculate aspect ratio
    img_width, img_height = pil_img.size
    img_aspect_ratio = img_width / img_height
    a4_aspect_ratio = A4_WIDTH_PX / A4_HEIGHT_PX
    
    # Resize to fit A4 while maintaining aspect ratio
    if img_aspect_ratio > a4_aspect_ratio:
        # Image is wider, fit to width
        new_width = A4_WIDTH_PX
        new_height = int(A4_WIDTH_PX / img_aspect_ratio)
    else:
        # Image is taller, fit to height
        new_height = A4_HEIGHT_PX
        new_width = int(A4_HEIGHT_PX * img_aspect_ratio)
    
    # Resize image
    resized_img = pil_img.resize((new_width, new_height), Image.Resampling.LANCZOS)
    
    # Create a white A4 page
    page = doc.new_page(width=A4_WIDTH_PX, height=A4_HEIGHT_PX)
    
    # Calculate position to center the image
    x_offset = (A4_WIDTH_PX - new_width) / 2
    y_offset = (A4_HEIGHT_PX - new_height) / 2
    
    # Convert PIL image to bytes
    img_bytes = BytesIO()
    resized_img.save(img_bytes, format='PNG')
    img_bytes.seek(0)
    
    # Insert image centered on the page
    rect = fitz.Rect(x_offset, y_offset, x_offset + new_width, y_offset + new_height)
    page.insert_image(rect, stream=img_bytes.getvalue())
    
    pil_img.close()

doc.save('/tmp/pdf_processor/images.pdf')
doc.close()
        `;
        
        setProgress(70);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile('/tmp/pdf_processor/images.pdf');
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'images_converted.pdf';
        a.click();
        
        imgPaths.forEach(p => fs.unlink(p));
        fs.unlink('/tmp/pdf_processor/images.pdf');
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
        console.error(e);
    }
}

async function addPageNumbersOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const position = document.getElementById('numberPosition').value;
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buf = await file.arrayBuffer();
        const fs = pyodide.FS;
        fs.writeFile('/tmp/pdf_processor/num_in.pdf', new Uint8Array(buf));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('/tmp/pdf_processor/num_in.pdf')
pos = '${position}'

for i, page in enumerate(doc):
    text = str(i + 1)
    rect = page.rect
    
    # Calculate point
    if pos == 'bottom-center':
        p = fitz.Point(rect.width/2, rect.height - 20)
        align = 1 # center
    elif pos == 'bottom-right':
        p = fitz.Point(rect.width - 40, rect.height - 20)
        align = 2 # right
    elif pos == 'top-right':
        p = fitz.Point(rect.width - 40, 30)
        align = 2
    else:
        p = fitz.Point(rect.width/2, rect.height - 20)
        align = 1
        
    page.insert_text(p, text, fontsize=12, color=(0, 0, 0))

doc.save('/tmp/pdf_processor/num_out.pdf')
doc.close()
        `;
        
        setProgress(70);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile('/tmp/pdf_processor/num_out.pdf');
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'numbered_' + file.name;
        a.click();
        
        fs.unlink('/tmp/pdf_processor/num_in.pdf');
        fs.unlink('/tmp/pdf_processor/num_out.pdf');
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
        console.error(e);
    }
}

async function signPDFOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    if (!signatureFile) {
        showToast('Select a Signature image', 'error');
        return;
    }
    
    const pageNum = parseInt(document.getElementById('signPage').value) - 1;
    const position = document.getElementById('signPosition').value;
    const width = parseInt(document.getElementById('signWidth').value);
    const customX = parseInt(document.getElementById('signX').value);
    const customY = parseInt(document.getElementById('signY').value);
    
    try {
        setProgress(10);
        const fs = pyodide.FS;
        
        // Write PDF
        const pdfBuf = await selectedFiles[0].arrayBuffer();
        fs.writeFile('/tmp/pdf_processor/sign_in.pdf', new Uint8Array(pdfBuf));
        
        // Write Signature
        const sigBuf = await signatureFile.arrayBuffer();
        const sigExt = signatureFile.name.split('.').pop();
        const sigPath = '/tmp/pdf_processor/sig.' + sigExt;
        fs.writeFile(sigPath, new Uint8Array(sigBuf));
        
        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('/tmp/pdf_processor/sign_in.pdf')
page_idx = ${pageNum}

if 0 <= page_idx < len(doc):
    page = doc[page_idx]
    rect = page.rect
    img_width = ${width}
    
    # Get image aspect ratio
    sig_img = fitz.open('${sigPath}')
    s_rect = sig_img[0].rect
    ratio = s_rect.height / s_rect.width
    img_height = img_width * ratio
    
    pos = '${position}'
    x = 0
    y = 0
    
    if pos == 'bottom-right':
        x = rect.width - img_width - 50
        y = rect.height - img_height - 50
    elif pos == 'bottom-left':
        x = 50
        y = rect.height - img_height - 50
    elif pos == 'custom':
        x = ${customX}
        y = ${customY}
        
    insert_rect = fitz.Rect(x, y, x + img_width, y + img_height)
    page.insert_image(insert_rect, filename='${sigPath}')

doc.save('/tmp/pdf_processor/sign_out.pdf')
doc.close()
sig_img.close()
        `;
        
        setProgress(70);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile('/tmp/pdf_processor/sign_out.pdf');
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'signed_' + selectedFiles[0].name;
        a.click();
        
        fs.unlink('/tmp/pdf_processor/sign_in.pdf');
        fs.unlink('/tmp/pdf_processor/sign_out.pdf');
        fs.unlink(sigPath);
        setProgress(100);
        hideProgress();
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
        console.error(e);
    }
}

async function addWatermarkOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    const text = document.getElementById('watermarkText').value;
    const size = parseInt(document.getElementById('watermarkSize').value);
    const opacity = parseFloat(document.getElementById('watermarkOpacity').value);
    const rotation = parseInt(document.getElementById('watermarkRotation').value);

    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const fs = pyodide.FS;
        const inFile = `/tmp/pdf_processor/wm_in.pdf`;
        const outFile = `/tmp/pdf_processor/wm_out.pdf`;
        fs.writeFile(inFile, bytes);

        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${inFile}')
for page in doc:
    rect = page.rect
    point = fitz.Point(rect.width / 2, rect.height / 2)
    page.insert_text(
        point, 
        "${text}", 
        fontsize=${size}, 
        rotate=${rotation}, 
        color=(0, 0, 0), 
        fill_opacity=${opacity}
    )

doc.save('${outFile}')
doc.close()
        `;
        
        setProgress(60);
        await pyodide.runPythonAsync(pythonCode);
        
        const data = fs.readFile(outFile);
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'watermarked_' + file.name;
        a.click();

        fs.unlink(inFile);
        fs.unlink(outFile);
        setProgress(100);
        hideProgress();
        showToast('Watermarked PDF Downloaded');
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
        console.error(e);
    }
}

async function getMetadataOperation() {
    if (selectedFiles.length === 0) {
        showToast('Select a PDF', 'error');
        return;
    }
    
    try {
        setProgress(10);
        const file = selectedFiles[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const fs = pyodide.FS;
        const filename = `/tmp/pdf_processor/meta_${Date.now()}.pdf`;
        fs.writeFile(filename, bytes);

        const pythonCode = `
import pymupdf as fitz
doc = fitz.open('${filename}')
meta = doc.metadata
info = {
    "Pages": len(doc),
    "Title": meta.get("title", "N/A"),
    "Author": meta.get("author", "N/A"),
    "Subject": meta.get("subject", "N/A"),
    "Keywords": meta.get("keywords", "N/A"),
    "Creator": meta.get("creator", "N/A"),
    "Producer": meta.get("producer", "N/A"),
    "CreationDate": meta.get("creationDate", "N/A"),
    "ModDate": meta.get("modDate", "N/A"),
    "Format": doc.metadata.get("format", "N/A"),
    "Encryption": "Yes" if doc.is_encrypted else "No"
}
doc.close()
info
        `;
        
        setProgress(60);
        const infoProxy = await pyodide.runPythonAsync(pythonCode);
        const infoJs = infoProxy.toJs({ dict_converter: Object.fromEntries });
        fs.unlink(filename);
        setProgress(100);
        hideProgress();

        const grid = document.getElementById('metadataGrid');
        grid.innerHTML = '';
        for (const [key, value] of Object.entries(infoJs)) {
            const card = document.createElement('div');
            card.className = 'info-card';
            card.innerHTML = `
                <div class="info-card-content">
                    <h3>${key}</h3>
                    <p>${value || 'N/A'}</p>
                </div>
            `;
            grid.appendChild(card);
        }
        document.getElementById('metadataOutput').classList.add('show');
    } catch (e) {
        showToast(e.message, 'error');
        hideProgress();
    }
}

// ============================================================================
// DOWNLOAD FUNCTIONS
// ============================================================================
function downloadText() {
    if (extractedText) {
        const blob = new Blob([extractedText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'extracted-text.txt';
        a.click();
        URL.revokeObjectURL(url);
    }
}

function downloadOCRText() {
    if (ocrExtractedText) {
        const blob = new Blob([ocrExtractedText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ocr-extracted-text.txt';
        a.click();
        URL.revokeObjectURL(url);
    }
}
// ============================================================================
// TESSERACT INITIALIZATION
// ============================================================================
async function initTesseract() {
    try {
        console.log('Tesseract initialization skipped - using direct recognize call with local paths if needed.');
        // If you need to configure local paths for Tesseract.js, 
        // you would typically do it when creating a worker:
        /*
        const worker = await Tesseract.createWorker('eng', 1, {
            workerPath: './lib/tesseract/worker.min.js',
            langPath: './lib/tesseract/lang-data',
            corePath: './lib/tesseract/tesseract-core.wasm.js',
        });
        */
    } catch (error) {
        console.error('Tesseract initialization failed:', error);
    }
}
