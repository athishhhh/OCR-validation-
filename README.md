# OCR Validation Pipeline

A modern, full-featured OCR validation system for processing and validating financial documents (annual reports, balance sheets, income statements). Built with **React**, **Vite**, **pdf.js**, **Tesseract.js**, and **Tailwind CSS**.

## 🎯 Overview

This application extracts text from PDF documents using **Tesseract.js OCR**, then runs it through a **10-stage validation pipeline** that combines rule-based validation, ML anomaly detection, and intelligent field prediction.

## ✨ Key Features

- **Client-side PDF rendering** — No server uploads required
- **In-browser OCR** — Tesseract.js processes PDFs in the browser
- **Multi-stage pipeline** — PDF Ingestion → OCR → Normalization → Field Prediction → Validation → Anomaly Detection → Correction → Decision Engine → Human Review
- **Smart decision routing** — Auto-accepts high-confidence lines, flags uncertain ones
- **Results export** — Download validation results as JSON
- **Modern UI** — Google/Apple-inspired design with Tailwind CSS

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm 8+

### Installation

\\\ash
git clone https://github.com/athishhhh/OCR-validation-.git
cd OCR-validation-
npm install
npm run dev
\\\

Open **http://localhost:5173** in your browser.

### Build for Production

\\\ash
npm run build
npm run preview
\\\

## 📋 Usage

1. **Upload PDF** — Click "Choose PDF File" and select a document
2. **View Preview** — Click "Show Preview" to see rendered pages
3. **Run Pipeline** — Click "Run Validation Pipeline" to process OCR and validation
4. **Review Results** — Check validation score and line-by-line analysis
5. **Export** — Click "Export Results" to download JSON output

## 🏗️ Architecture

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + Vite 5 |
| Styling | Tailwind CSS 3.4 |
| PDF Rendering | pdf.js 3.11 |
| OCR Engine | Tesseract.js 4.1 |
| Icons | lucide-react |

### Pipeline Stages

1. **PDF Ingestion** — Convert PDF to canvas images
2. **OCR Extraction** — Extract text with Tesseract.js
3. **Normalization** — Fix OCR errors (O→0, l→1, etc.)
4. **Field Prediction** — Map text to financial fields
5. **Rule Validation** — Check constraints
6. **Anomaly Detection** — ML-based error detection
7. **LLM Correction** — Suggest fixes (ready for integration)
8. **Decision Engine** — Route to auto-accept/quick/manual review
9. **Human Review** — UI ready for manual verification
10. **Retraining** — Feedback collection (ready for integration)

## ⚙️ Configuration

### Tesseract Settings
Edit performOCR() in src/App.jsx:
\\\javascript
const { data } = await Tesseract.recognize(canvas, 'eng', {
  logger: m => { /* progress callback */ }
});
\\\

### PDF Render Scale
Adjust scale in generatePDFPreview() and performOCR():
\\\javascript
const viewport = page.getViewport({ scale: 1.5 }); // 150% quality
\\\

## 📊 Validation Score

Score = (Confidence × 100) - (Anomaly × 20) - (RuleFailures × 30) + (AutoAccepted × 10)

- **90+** = Excellent ✅
- **75-89** = Good ⚠️
- **<75** = Needs review ❌

## 📦 Dependencies

\\\json
{
  "react": "18.2.0",
  "react-dom": "18.2.0",
  "lucide-react": "0.263.0",
  "pdfjs-dist": "^3.11.0",
  "tesseract.js": "^4.1.1",
  "vite": "^5.0.0",
  "tailwindcss": "^3.4.8",
  "postcss": "^8.4.21",
  "autoprefixer": "^10.4.14"
}
\\\

## 🚦 Troubleshooting

| Issue | Solution |
|-------|----------|
| OCR very slow | First run downloads ~70MB model. Cached afterwards. |
| Preview blank | PDF might be encrypted/corrupted. Try another file. |
| No text extracted | Image quality too low or language not English. |

## 🔄 Future Enhancements

- Multi-language OCR support
- Backend API integration
- Batch PDF processing
- Custom validation rules builder
- Real-time collaboration

## 📝 License

MIT License — Free to use and modify

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: \git checkout -b feature/MyFeature\
3. Commit: \git commit -m 'Add MyFeature'\
4. Push: \git push origin feature/MyFeature\
5. Open Pull Request

## 📞 Support

[Open GitHub Issue](https://github.com/athishhhh/OCR-validation-/issues) for bugs/questions

## 🎓 Learn More

- [pdf.js documentation](https://mozilla.github.io/pdf.js/)
- [Tesseract.js guide](https://tesseract.projectnaptha.com/)
- [Tailwind CSS docs](https://tailwindcss.com/)
- [React documentation](https://react.dev/)

---

**Built with ❤️ for financial document processing**
