# PyMuPdf WebApp

A powerful, fully client-side **PDF processing web application** built using **JavaScript and Python WebAssembly (Pyodide)**.  
All operations run **entirely inside the browser**, including advanced PDF manipulation and OCR, with **no server, no uploads, and no privacy risks**.

---

## 🚀 Key Highlights

- Runs **Python directly in the browser** using WebAssembly
- Uses **PyMuPDF, Pillow, OpenCV, NumPy** inside WASM
- Hybrid **JavaScript + Python** architecture
- OCR support for scanned PDFs
- Modern, responsive UI
- Fully offline-capable after initial load
- No backend
- No cloud processing
- No file uploads
- Maximum privacy

---

## ✨ Features

- 📄 Extract text from PDF files
- 🖼️ Convert PDF pages to images
- 🗜️ Compress PDFs (DPI & quality control)
- 🔗 Merge multiple PDFs
- ✂️ Split PDFs into individual pages
- 📑 Organize pages (rotate, insert, delete)
- 🔒 Encrypt & decrypt PDFs
- 📝 Edit PDFs (add text & images)
- 🔍 OCR scanned PDFs (image-based pages)
- 📷 Convert images to PDF
- 🔢 Add page numbers
- ✍️ Sign PDFs with image signatures
- 💧 Add watermarks
- ℹ️ View PDF metadata
- 📥 Download results instantly

---

## 🧠 Technologies Used

### Frontend
- **HTML5** – Semantic structure and layout
- **CSS3** – Custom styling, animations, responsive UI
- **JavaScript (ES6+)** – Application logic and UI interaction

### Python in WebAssembly (WASM)
- **Pyodide** – Runs Python directly in the browser via WebAssembly
- **Micropip** – Python package installation inside WASM
- **PyMuPDF (fitz)** – Core PDF processing engine
- **Pillow (PIL)** – Image handling and conversion
- **NumPy** – Image and pixel data manipulation
- **OpenCV (cv2)** – Image preprocessing for OCR

### OCR Stack
- **Tesseract.js** – OCR engine for recognizing text
- **OpenCV + Python WASM** – Image thresholding and preprocessing
- **Hybrid OCR Logic**:
  - Native text extraction for digital PDFs
  - Automatic OCR for scanned (image-only) pages

### Browser APIs
- **File API** – Read local files securely
- **Blob & URL APIs** – Generate downloadable files
- **Drag & Drop API** – Smooth file uploads
- **WebAssembly (WASM)** – High-performance Python execution

---

# 🧪 How to Run

1. Clone or download this repository
2. Open index.html in a modern browser
3. Wait for Pyodide initialization
4. Select a tool and upload files
5. Process and download results instantly
6. No installation, no server, no build step required

# 🔒 Privacy & Security

- All processing happens locally in your browser
- Files never leave your device
- Ideal for sensitive or confidential documents

# 🎯 Use Cases

- Secure PDF processing without online tools
- OCR for scanned documents
- Students and researchers
- Office and legal document handling
- WebAssembly + Python experimentation
- Offline-capable document utilities
