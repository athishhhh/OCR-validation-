import React, { useState, useRef } from 'react';
import { AlertCircle, CheckCircle, Edit, FileText, Zap, Eye, RefreshCw, Upload, Loader, Download, Image, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
import Tesseract from 'tesseract.js';

const OCRValidationSystem = () => {
  const [currentStage, setCurrentStage] = useState(0);
  const [pipelineResults, setPipelineResults] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrData, setOcrData] = useState(null);
  const [pdfPreview, setPdfPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [validationScore, setValidationScore] = useState(null);
  const fileInputRef = useRef(null);

  // Convert PDF Blob to preview images using pdf.js
  const generatePDFPreview = async (pdfBlob) => {
    try { GlobalWorkerOptions.workerSrc = pdfjsWorker; } catch (e) { /* ignore */ }
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const loadingTask = getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      await page.render({ canvasContext: context, viewport }).promise;
      pages.push(canvas.toDataURL('image/png'));
    }

    return { pages };
  };

  // Store file Blob for later OCR processing (avoids ArrayBuffer detachment)
  const [pdfFile, setPdfFile] = useState(null);

  // Quick PDF preview generation (fast, no OCR)
  const processPDF = async (file) => {
    setIsProcessing(true);
    setCurrentStage(1);

    try {
      // Store the file Blob itself (not ArrayBuffer) to avoid detachment issues
      setPdfFile(file);

      // Generate preview images only
      const preview = await generatePDFPreview(file);
      setPdfPreview(preview);
      setShowPreview(true);

      // Set OCR data to empty structure; OCR runs later on demand
      try { GlobalWorkerOptions.workerSrc = pdfjsWorker; } catch (e) { /* ignore */ }
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      // Create empty OCR structure (will be filled when pipeline runs)
      const emptyPages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        emptyPages.push({ pageNumber: p, lines: [] });
      }

      const ocrOutput = { fileName: file.name, pageCount: pdf.numPages, pages: emptyPages };
      setOcrData(ocrOutput);
    } catch (err) {
      console.error('PDF processing error:', err);
      alert('Error processing PDF: ' + err.message);
    }

    setIsProcessing(false);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file');
      return;
    }

    setUploadedFile(file);
    setPipelineResults(null);
    setValidationScore(null);
    await processPDF(file);
  };

  const calculateValidationScore = (results) => {
    const nonEmpty = results.filter(l => l.valueType !== 'empty');
    const totalLines = nonEmpty.length || 1;
    const autoAccepted = results.filter(l => l.status === 'auto_accept').length;
    const quickReview = results.filter(l => l.status === 'quick_review').length;
    const manualReview = results.filter(l => l.status === 'manual_review').length;
    const avgConfidence = nonEmpty.reduce((s, l) => s + (l.confidence || 0), 0) / totalLines;
    const avgAnomalyScore = nonEmpty.reduce((s, l) => s + (l.anomalyScore || 0), 0) / totalLines;
    const totalRuleFailures = nonEmpty.reduce((s, l) => s + (l.ruleFailures ? l.ruleFailures.length : 0), 0);

    const confidenceScore = avgConfidence * 100;
    const anomalyPenalty = avgAnomalyScore * 20;
    const ruleFailurePenalty = (totalRuleFailures / totalLines) * 30;
    const autoAcceptBonus = (autoAccepted / totalLines) * 10;

    const overallScore = Math.max(0, Math.min(100, confidenceScore - anomalyPenalty - ruleFailurePenalty + autoAcceptBonus));

    return {
      overallScore: overallScore.toFixed(1),
      totalLines,
      autoAccepted,
      quickReview,
      manualReview,
      avgConfidence: (avgConfidence * 100).toFixed(1),
      avgAnomalyScore: avgAnomalyScore.toFixed(2),
      totalRuleFailures,
      accuracy: ((autoAccepted / totalLines) * 100).toFixed(1),
      quality: confidenceScore.toFixed(1)
    };
  };

  const pipeline = {
    normalize: (lines) => {
      return lines.map(line => {
        if (!line.raw || !line.raw.toString().trim()) return { ...line, normalized: '', parsedValue: null, valueType: 'empty' };

        let normalized = line.raw.toString()
          .replace(/O/g, '0')
          .replace(/l(?=\d)/g, '1')
          .replace(/I/g, '1')
          .replace(/\s+/g, ' ')
          .trim();
        const valueMatch = normalized.match(/\$?\s*([\d,]+)/);
        const parsedValue = valueMatch ? parseFloat(valueMatch[1].replace(/,/g, '')) : null;

        return {
          ...line,
          normalized,
          parsedValue,
          valueType: parsedValue !== null ? 'numeric' : normalized ? 'text' : 'empty'
        };
      });
    },

    predictLabels: (lines) => {
      const labelPatterns = {
        'header': /balance\s+sheet|income\s+statement|cash\s+flow/i,
        'section_header': /^(assets|liabilities|equity|revenue|expenses)$/i,
        'subsection': /current\s+(assets|liabilities)|shareholders/i,
        'line_item': /cash|receivable|payable|inventory|stock|earnings/i,
        'total': /total/i,
        'date': /\d{4}|december|january/i
      };

      return lines.map(line => {
        if (line.valueType === 'empty') {
          return { ...line, predictedLabel: 'blank_line', labelConfidence: 1.0 };
        }

        let predictedLabel = 'unknown';
        let confidence = 0.5;

        for (const [label, pattern] of Object.entries(labelPatterns)) {
          if (pattern.test(line.normalized)) {
            predictedLabel = label;
            confidence = 0.9;
            break;
          }
        }

        return { ...line, predictedLabel, labelConfidence: confidence };
      });
    },

    validateRules: (lines) => {
      return lines.map(line => {
        if (line.valueType === 'empty') {
          return { ...line, ruleFailures: [], rulePassed: true };
        }

        const failures = [];
        if (line.valueType === 'numeric' && line.parsedValue === null) {
          failures.push('numeric_parse_failed');
        }
        if (line.confidence < 0.90 && line.valueType !== 'empty') {
          failures.push('low_ocr_confidence');
        }
        if (line.valueType === 'numeric' && /[OlI]/.test(line.raw)) {
          failures.push('suspicious_chars_in_number');
        }
        if (line.predictedLabel === 'total' && line.valueType !== 'numeric') {
          failures.push('total_line_missing_value');
        }

        return { ...line, ruleFailures: failures, rulePassed: failures.length === 0 };
      });
    },

    detectAnomalies: (lines) => {
      return lines.map(line => {
        if (line.valueType === 'empty') {
          return { ...line, anomalyScore: 0, isAnomaly: false };
        }

        let anomalyScore = 0;
        if (line.confidence < 0.90) anomalyScore += 0.3;
        if (line.ruleFailures && line.ruleFailures.length > 0) anomalyScore += 0.4;
        if (line.labelConfidence < 0.7) anomalyScore += 0.2;
        if (line.confidence < 0.85 && line.valueType === 'numeric') anomalyScore += 0.2;

        return { ...line, anomalyScore: Math.min(anomalyScore, 1.0), isAnomaly: anomalyScore > 0.5 };
      });
    },

    suggestCorrections: (lines) => {
      return lines.map(line => {
        let suggestions = [];
        if (line.ruleFailures && line.ruleFailures.includes('suspicious_chars_in_number')) {
          const corrected = line.raw.toString().replace(/O/g, '0').replace(/l/g, '1').replace(/I/g, '1');
          suggestions.push({ type: 'text_correction', original: line.raw, suggested: corrected, confidence: 0.85, reason: 'OCR character correction (O→0, l/I→1)' });
        }
        if (line.confidence < 0.85 && line.valueType === 'numeric') {
          suggestions.push({ type: 'manual_verification', original: line.raw, suggested: line.normalized, confidence: 0.70, reason: 'Low confidence numeric value - manual verification recommended' });
        }
        return { ...line, suggestions };
      });
    },

    makeDecisions: (lines) => {
      return lines.map(line => {
        if (line.valueType === 'empty') return { ...line, status: 'auto_accept' };
        let status = 'auto_accept';
        if (line.ruleFailures && line.ruleFailures.length > 0) status = 'manual_review';
        else if (line.anomalyScore > 0.5) status = 'quick_review';
        else if (line.confidence < 0.85 && line.valueType === 'numeric') status = 'quick_review';
        return { ...line, status };
      });
    }
  };

  const performOCR = async () => {
    if (!pdfFile || !ocrData) return ocrData;

    try {
      GlobalWorkerOptions.workerSrc = pdfjsWorker;
      // Get fresh ArrayBuffer from the Blob each time (avoids detachment issues)
      const arrayBuffer = await pdfFile.arrayBuffer();
      const loadingTask = getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdf = await loadingTask.promise;
      const pagesOutput = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        setCurrentStage(2);
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        await page.render({ canvasContext: ctx, viewport }).promise;

        // Run Tesseract OCR on this page
        let lines = [];
        try {
          const { data } = await Tesseract.recognize(canvas, 'eng', {
            logger: m => { /* silent */ }
          });

          const words = data.words || [];
          let id = 1;
          for (const w of words) {
            if (w.text && w.text.trim()) {
              const bbox = [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1];
              const confidence = Math.min((w.confidence || 0) / 100.0, 0.99);
              lines.push({ id: id++, raw: w.text, bbox, confidence });
            }
          }
        } catch (ocrErr) {
          console.warn('OCR error on page', p, ocrErr);
          // Fallback: return empty lines
        }

        pagesOutput.push({ pageNumber: p, lines });
      }

      const updatedOcrData = { ...ocrData, pages: pagesOutput };
      setOcrData(updatedOcrData);
      return updatedOcrData;
    } catch (err) {
      console.error('OCR perform error:', err);
      return ocrData; // Return what we have
    }
  };

  const runPipeline = async () => {
    if (!ocrData) return;

    // Perform OCR if not already done
    setIsProcessing(true);
    const ocrResult = await performOCR();
    setIsProcessing(false);

    if (!ocrResult || !ocrResult.pages || ocrResult.pages.length === 0) {
      alert('OCR failed or no data extracted. Please check your PDF.');
      return;
    }

    setCurrentStage(3);
    await new Promise(r => setTimeout(r, 200));
    let results = ocrResult.pages[0].lines;
    results = pipeline.normalize(results);
    setCurrentStage(4);
    await new Promise(r => setTimeout(r, 200));
    results = pipeline.predictLabels(results);
    setCurrentStage(5);
    await new Promise(r => setTimeout(r, 200));
    results = pipeline.validateRules(results);
    setCurrentStage(6);
    await new Promise(r => setTimeout(r, 200));
    results = pipeline.detectAnomalies(results);
    setCurrentStage(7);
    await new Promise(r => setTimeout(r, 200));
    results = pipeline.suggestCorrections(results);
    setCurrentStage(8);
    await new Promise(r => setTimeout(r, 200));
    results = pipeline.makeDecisions(results);
    setCurrentStage(9);

    setPipelineResults(results);
    const score = calculateValidationScore(results);
    setValidationScore(score);
  };

  const exportResults = () => {
    const exportData = { fileName: uploadedFile?.name, processedAt: new Date().toISOString(), validationScore, results: pipelineResults };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-validation-${Date.now()}.json`;
    a.click();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'auto_accept': return 'bg-green-100 text-green-700 border-green-300';
      case 'quick_review': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'manual_review': return 'bg-red-100 text-red-700 border-red-300';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getScoreColor = (score) => {
    if (!score) return '';
    const s = parseFloat(score);
    if (s >= 90) return 'text-green-600';
    if (s >= 75) return 'text-yellow-600';
    return 'text-red-600';
  };

  const stages = [
    { name: 'PDF Ingestion', icon: FileText, desc: 'Convert PDF to images' },
    { name: 'OCR Extraction', icon: Eye, desc: 'Extract text & confidence' },
    { name: 'Normalization', icon: Edit, desc: 'Clean OCR errors' },
    { name: 'Field Prediction', icon: Zap, desc: 'Identify field labels' },
    { name: 'Rule Validation', icon: CheckCircle, desc: 'Check constraints' },
    { name: 'Anomaly Detection', icon: AlertCircle, desc: 'ML-based analysis' },
    { name: 'LLM Correction', icon: RefreshCw, desc: 'Smart suggestions' },
    { name: 'Decision Engine', icon: CheckCircle, desc: 'Auto-routing' },
    { name: 'Human Review', icon: Eye, desc: 'Manual verification' },
    { name: 'Retraining', icon: RefreshCw, desc: 'Improve models' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white border-b border-gray-200 shadow-sm rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">OCR Validation Pipeline</h1>
              <p className="text-sm text-gray-600 mt-1">Annual Report Filing Compliance System</p>
            </div>
            {pipelineResults && (
              <button onClick={exportResults} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm">
                <Download className="w-4 h-4" />
                Export Results
              </button>
            )}
          </div>
        </div>

        {!uploadedFile && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center mb-6">
            <div className="max-w-md mx-auto">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload className="w-10 h-10 text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Upload Annual Report PDF</h2>
              <p className="text-gray-600 mb-6">Upload your PDF to extract and validate financial data</p>
              <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-sm font-medium">
                <Upload className="w-5 h-5" />
                Choose PDF File
              </button>
              <p className="text-xs text-gray-500 mt-4">Maximum file size: 10MB</p>
            </div>
          </div>
        )}

        {uploadedFile && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">{uploadedFile.name}</h3>
                  <p className="text-sm text-gray-600">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowPreview(!showPreview)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition flex items-center gap-2">
                  <Image className="w-4 h-4" />
                  {showPreview ? 'Hide' : 'Show'} Preview
                </button>
                <button onClick={() => { setUploadedFile(null); setPdfFile(null); setOcrData(null); setPipelineResults(null); setValidationScore(null); setPdfPreview(null); setShowPreview(false); setCurrentStage(0); }} className="px-4 py-2 text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition flex items-center gap-2">
                  <X className="w-4 h-4" />
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {showPreview && pdfPreview && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Document Preview</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(0, p-1))} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronLeft className="w-5 h-5 text-gray-600" /></button>
                <span className="text-sm text-gray-600">Page {currentPage+1} of {pdfPreview.pages.length}</span>
                <button onClick={() => setCurrentPage(p => Math.min(pdfPreview.pages.length-1, p+1))} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronRight className="w-5 h-5 text-gray-600" /></button>
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
              <img src={pdfPreview.pages[currentPage]} alt="PDF Preview" className="w-full h-auto" />
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-6">
            <div className="flex items-center justify-center gap-3">
              <Loader className="w-6 h-6 animate-spin text-blue-600" />
              <span className="text-gray-700 font-medium">Processing PDF with OCR...</span>
            </div>
          </div>
        )}

        {ocrData && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Pipeline Progress</h2>
            <div className="space-y-3">
              {stages.map((stage, idx) => {
                const Icon = stage.icon;
                const isActive = idx === currentStage;
                const isCompleted = idx < currentStage;
                return (
                  <div key={idx} className={`flex items-center gap-4 p-4 rounded-lg transition ${isActive ? 'bg-blue-50 border-2 border-blue-500' : isCompleted ? 'bg-green-50 border-2 border-green-300' : 'bg-gray-50 border-2 border-transparent'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isActive ? 'bg-blue-600' : isCompleted ? 'bg-green-600' : 'bg-gray-300'}`}>
                      {isCompleted ? (<CheckCircle className="w-6 h-6 text-white" />) : (<Icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-gray-500'}`} />)}
                    </div>
                    <div className="flex-1">
                      <div className={`font-medium ${isActive ? 'text-blue-900' : isCompleted ? 'text-green-900' : 'text-gray-500'}`}>{stage.name}</div>
                      <div className="text-sm text-gray-600">{stage.desc}</div>
                    </div>
                    {isActive && (<Loader className="w-5 h-5 animate-spin text-blue-600" />)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {ocrData && !pipelineResults && !isProcessing && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 text-center">
            <button onClick={runPipeline} className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl hover:from-green-700 hover:to-green-800 transition shadow-lg font-medium">
              <Zap className="w-5 h-5" />
              Run Validation Pipeline
            </button>
          </div>
        )}

        {validationScore && (
          <div className="bg-gradient-to-br from-white to-blue-50 rounded-xl shadow-lg border border-blue-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Validation Score</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className={`text-3xl font-bold ${getScoreColor(parseFloat(validationScore.overallScore))}`}>{validationScore.overallScore}</div>
                <div className="text-sm text-gray-600">Overall validation score (0-100)</div>
              </div>
              <div className="text-sm text-gray-700">
                <div>Lines: {validationScore.totalLines}</div>
                <div>Auto-accepted: {validationScore.autoAccepted}</div>
                <div>Manual review: {validationScore.manualReview}</div>
                <div>Avg Confidence: {validationScore.avgConfidence}%</div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default OCRValidationSystem;
