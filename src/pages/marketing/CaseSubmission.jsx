import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import {
  Upload,
  FileText,
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  Pencil,
  Loader2,
  CheckCircle,
  Send,
  Clock,
  Package,
  Image as ImageIcon,
  Trash2,
} from "lucide-react";

/* ════════════════════════════════════════════════════════════════
   DATA
   ════════════════════════════════════════════════════════════════ */

const PRODUCTS = [
  {
    id: "ddso",
    name: "DDSO",
    fullName: "Diamond Digital Sleep Orthotic",
    category: "Sleep",
    image: "/images/ddso-front.webp",
    description:
      "SLS-printed mandibular advancement device for obstructive sleep apnea therapy.",
  },
  {
    id: "onp",
    name: "ONP",
    fullName: "Olmos Neuromuscular Positioner",
    category: "TMD",
    image: "/images/onp-front.webp",
    description:
      "Full-coverage neuromuscular orthotic for TMJ repositioning and stabilization.",
  },
  {
    id: "dorsal",
    name: "Dorsal",
    fullName: "Dorsal Repositioning Splint",
    category: "TMD",
    image: "/images/dorsal1.webp",
    description:
      "Adjustable dorsal fin design for controlled anterior mandibular repositioning.",
  },
  {
    id: "od-pmt",
    name: "OD-PMT",
    fullName: "Olmos Daytime PMT",
    category: "TMD",
    image: "/images/od-pmt.webp",
    description:
      "Ultra-thin daytime orthotic for postural management and muscle deprogramming.",
  },
];

const MATERIALS = {
  ddso: ["Nylon PA12"],
  onp: ["Nylon PA12", "Bioflex", "Trutaine"],
  dorsal: ["Acrylic", "Nylon PA12"],
  "od-pmt": ["Nylon PA12", "Clear Acrylic"],
};

const STEPS = [
  "Practice & Patient",
  "Select Product",
  "Clinical Details",
  "Upload Files",
  "Review",
];

const JOINT_SYMPTOMS = [
  "Clicking",
  "Popping",
  "Crepitus",
  "Locking",
  "Limited Opening",
  "Deviation",
];

const INITIAL_FORM = {
  doctorName: "",
  practiceName: "",
  email: "",
  phone: "",
  npi: "",
  patientFirst: "",
  patientLast: "",
  dob: "",
  gender: "",
  product: null,
  ahiScore: "",
  protrusion: "",
  verticalOpening: "",
  titrationType: "",
  previousAppliance: false,
  diagnosis: "",
  painLevel: 0,
  jointSymptoms: [],
  vdoAdjustment: "",
  arch: "",
  material: "",
  rushOrder: false,
  specialInstructions: "",
  scanFiles: [],
  photos: [],
  prescription: [],
  sleepStudy: [],
};

/* ════════════════════════════════════════════════════════════════
   SMALL UTILITY COMPONENTS
   ════════════════════════════════════════════════════════════════ */

const INPUT =
  "w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label, description }) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-surface-50 border border-surface-300/30">
      <div>
        <span className="text-sm font-medium text-navy/70">{label}</span>
        {description && (
          <p className="text-xs text-navy/30 mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-300 flex-shrink-0 ${
          checked ? "bg-accent-500" : "bg-surface-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   STEP HEADER (progress bar + label)
   ════════════════════════════════════════════════════════════════ */

function StepHeader({ current, total, labels }) {
  return (
    <div className="px-6 md:px-8 pt-6 pb-5 border-b border-surface-300/30">
      <div className="h-1.5 rounded-full bg-surface-200 mb-5">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-700 ease-out"
          style={{ width: `${((current + 1) / total) * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-[10px] text-navy/30 uppercase tracking-wider">
            Step {current + 1} of {total}
          </span>
          <h2 className="font-heading font-bold text-lg text-navy tracking-tight mt-0.5">
            {labels[current]}
          </h2>
        </div>
        {current < total - 1 && (
          <span className="hidden sm:block font-mono text-[10px] text-navy/20 uppercase tracking-wider">
            Next: {labels[current + 1]}
          </span>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   PRODUCT MODAL
   ════════════════════════════════════════════════════════════════ */

function ProductModal({ selected, onSelect, onClose }) {
  const ref = useRef(null);

  // close on escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div ref={ref} className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div

        className="absolute inset-0 bg-navy/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div

        className="relative bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-surface-300/30 flex items-center justify-between">
          <div>
            <h3 className="font-heading font-bold text-lg text-navy">
              Select Product
            </h3>
            <p className="text-xs text-navy/40 mt-0.5">
              Choose the orthotic for this case
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-100 flex items-center justify-center text-navy/30 hover:text-navy hover:bg-surface-200 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Product grid */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PRODUCTS.map((p) => (
            <button
              key={p.id}

              type="button"
              onClick={() => onSelect(p)}
              className={`group relative p-4 rounded-2xl border-2 transition-all duration-300 text-left hover:shadow-lg ${
                selected?.id === p.id
                  ? "border-brand-500 bg-brand-500/5 shadow-md"
                  : "border-surface-300/30 hover:border-brand-500/20"
              }`}
            >
              {selected?.id === p.id && (
                <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center z-10">
                  <Check size={12} className="text-white" />
                </div>
              )}
              <div className="aspect-square rounded-xl bg-surface-50 overflow-hidden mb-3">
                <img
                  src={p.image}
                  alt={p.name}
                  className="w-full h-full object-contain p-6 group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-heading font-bold text-sm text-navy">
                  {p.name}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    p.category === "Sleep"
                      ? "bg-accent-500/10 text-accent-600"
                      : "bg-brand-500/10 text-brand-500"
                  }`}
                >
                  {p.category}
                </span>
              </div>
              <p className="text-[11px] text-navy/40 leading-relaxed">
                {p.description}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   PRODUCT THUMBNAIL (the "cute little" selected card)
   ════════════════════════════════════════════════════════════════ */

function ProductThumb({ product, onEdit }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex items-center gap-4 p-3 pr-5 rounded-2xl bg-surface-50 border border-surface-300/30 cursor-pointer hover:border-brand-500/30 hover:shadow-md transition-all duration-300 w-full text-left"
    >
      <div className="w-16 h-16 rounded-xl bg-white overflow-hidden flex-shrink-0 border border-surface-300/20">
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-contain p-2"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-heading font-bold text-sm text-navy">
            {product.name}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              product.category === "Sleep"
                ? "bg-accent-500/10 text-accent-600"
                : "bg-brand-500/10 text-brand-500"
            }`}
          >
            {product.category}
          </span>
        </div>
        <p className="text-xs text-navy/40 truncate">{product.fullName}</p>
      </div>
      <Pencil
        size={14}
        className="text-navy/20 group-hover:text-brand-500 transition-colors flex-shrink-0"
      />
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════
   PAIN SCALE
   ════════════════════════════════════════════════════════════════ */

function PainScale({ value, onChange }) {
  const bg = (n) => {
    if (n <= 3) return "bg-emerald-500";
    if (n <= 5) return "bg-yellow-500";
    if (n <= 7) return "bg-orange-500";
    return "bg-red-500";
  };
  const ring = (n) => {
    if (n <= 3) return "ring-emerald-500";
    if (n <= 5) return "ring-yellow-500";
    if (n <= 7) return "ring-orange-500";
    return "ring-red-500";
  };

  return (
    <Field label="Pain Level">
      <div className="flex items-center gap-1.5 sm:gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
              value === n
                ? `${bg(n)} text-white scale-110 ring-2 ring-offset-2 ${ring(n)}`
                : "bg-surface-100 text-navy/40 hover:bg-surface-200"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-navy/25 px-1">
        <span>No pain</span>
        <span>Severe</span>
      </div>
    </Field>
  );
}

/* ════════════════════════════════════════════════════════════════
   SYMPTOM PILLS (multi-select)
   ════════════════════════════════════════════════════════════════ */

function SymptomPills({ selected, onChange }) {
  const toggle = (s) =>
    onChange(
      selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]
    );

  return (
    <Field label="Joint Symptoms (select all that apply)">
      <div className="flex flex-wrap gap-2">
        {JOINT_SYMPTOMS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
              selected.includes(s)
                ? "bg-brand-500 text-white shadow-sm"
                : "bg-surface-50 text-navy/50 border border-surface-300/50 hover:border-brand-500/30"
            }`}
          >
            {selected.includes(s) && (
              <Check size={12} className="inline mr-1.5 -mt-0.5" />
            )}
            {s}
          </button>
        ))}
      </div>
    </Field>
  );
}

/* ════════════════════════════════════════════════════════════════
   ARCH SELECTOR (radio cards)
   ════════════════════════════════════════════════════════════════ */

function ArchSelector({ value, onChange }) {
  const opts = [
    { id: "upper", label: "Upper", desc: "Maxillary arch" },
    { id: "lower", label: "Lower", desc: "Mandibular arch" },
    { id: "both", label: "Both", desc: "Full coverage" },
  ];

  return (
    <Field label="Arch" required>
      <div className="grid grid-cols-3 gap-3">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`p-4 rounded-2xl border-2 text-center transition-all duration-300 ${
              value === o.id
                ? "border-brand-500 bg-brand-500/5"
                : "border-surface-300/30 hover:border-brand-500/20"
            }`}
          >
            <span
              className={`block text-sm font-semibold ${
                value === o.id ? "text-brand-500" : "text-navy/70"
              }`}
            >
              {o.label}
            </span>
            <span className="block text-[10px] text-navy/30 mt-0.5">
              {o.desc}
            </span>
          </button>
        ))}
      </div>
    </Field>
  );
}

/* ════════════════════════════════════════════════════════════════
   FILE UPLOAD ZONE
   ════════════════════════════════════════════════════════════════ */

function FileUploadZone({ label, hint, accept, files, onAdd, onRemove }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) onAdd(e.dataTransfer.files);
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-2">
        {label}
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 ${
          drag
            ? "border-brand-500 bg-brand-500/5"
            : "border-surface-300/50 bg-surface-50/50 hover:border-brand-500/30"
        }`}
      >
        <Upload
          size={24}
          className={`mx-auto mb-2 transition-colors ${
            drag ? "text-brand-500" : "text-navy/20"
          }`}
        />
        <p className="text-sm text-navy/50">
          Drag & drop files here, or{" "}
          <span className="text-brand-500 font-medium">browse</span>
        </p>
        {hint && <p className="mt-1 text-[11px] text-navy/25">{hint}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAdd(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="group flex items-center gap-2.5 pl-2 pr-1.5 py-1.5 rounded-xl bg-surface-50 border border-surface-300/30"
            >
              {f.preview ? (
                <img
                  src={f.preview}
                  alt=""
                  className="w-8 h-8 rounded-lg object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-surface-200/60 flex items-center justify-center">
                  <FileText size={14} className="text-navy/30" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-navy/70 truncate max-w-[110px]">
                  {f.name}
                </p>
                <p className="text-[10px] text-navy/25">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(f.id);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center text-navy/20 hover:text-red-400 hover:bg-red-50 transition-all"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   REVIEW HELPERS
   ════════════════════════════════════════════════════════════════ */

function ReviewSection({ title, onEdit, children }) {
  return (
    <div className="p-4 md:p-5 rounded-2xl bg-surface-50/50 border border-surface-300/20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-heading font-semibold text-sm text-navy">
          {title}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium transition-colors"
        >
          <Pencil size={11} /> Edit
        </button>
      </div>
      {children}
    </div>
  );
}

function ReviewField({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-0.5">
      <span className="text-[10px] font-semibold text-navy/25 uppercase tracking-wider w-24 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-navy/70">{value}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   HERO
   ════════════════════════════════════════════════════════════════ */

function CaseHero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-ch]", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.2,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative bg-gradient-to-b from-navy via-brand-900 to-surface-100 pt-32 pb-24"
    >
      <div className="section-pad text-center max-w-2xl mx-auto">
        <span
          data-ch
          className="font-mono text-xs text-white/40 uppercase tracking-widest"
        >
          Case Submission
        </span>
        <h1
          data-ch
          className="mt-4 font-heading font-bold text-3xl md:text-5xl text-white tracking-tight"
        >
          Submit a New Case
        </h1>
        <p
          data-ch
          className="mt-3 text-white/50 text-sm md:text-base max-w-lg mx-auto"
        >
          Complete the form below to start a case with Diamond Orthotic
          Laboratory. We begin fabrication within 24 hours of receiving your
          digital files.
        </p>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════════ */

export function CaseSubmissionPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL_FORM);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState([]);
  const contentRef = useRef(null);

  const update = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const addFiles = (field, fileList) => {
    const newFiles = Array.from(fileList).map((file) => ({
      id: Math.random().toString(36).slice(2, 10),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      preview: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null,
    }));
    setForm((prev) => ({ ...prev, [field]: [...prev[field], ...newFiles] }));
  };

  const removeFile = (field, id) => {
    setForm((prev) => {
      const f = prev[field].find((x) => x.id === id);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return { ...prev, [field]: prev[field].filter((x) => x.id !== id) };
    });
  };

  const handleProductSelect = (product) => {
    setForm((prev) => ({
      ...prev,
      product,
      ahiScore: "",
      protrusion: "",
      verticalOpening: "",
      titrationType: "",
      previousAppliance: false,
      diagnosis: "",
      painLevel: 0,
      jointSymptoms: [],
      vdoAdjustment: "",
      material: "",
    }));
    setShowModal(false);
  };

  const validate = () => {
    const errs = [];
    if (step === 0) {
      if (!form.doctorName.trim()) errs.push("doctorName");
      if (!form.practiceName.trim()) errs.push("practiceName");
      if (!form.email.trim()) errs.push("email");
      if (!form.patientFirst.trim()) errs.push("patientFirst");
      if (!form.patientLast.trim()) errs.push("patientLast");
    }
    if (step === 1 && !form.product) errs.push("product");
    if (step === 2) {
      if (!form.arch) errs.push("arch");
      if (!form.material) errs.push("material");
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const next = () => {
    if (!validate()) return;
    setErrors([]);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const prev = () => {
    setErrors([]);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 2000);
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Animate step content on change
  useEffect(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }
      );
    }
  }, [step]);

  const errClass = (field) =>
    errors.includes(field) ? "border-red-400 ring-2 ring-red-400/10" : "";

  const allFiles = [
    ...form.scanFiles,
    ...form.photos,
    ...form.prescription,
    ...form.sleepStudy,
  ];

  /* ── SUCCESS ── */
  if (submitted) {
    return (
      <div>
        <CaseHero />
        <section className="relative z-10 section-pad -mt-8 pb-20">
          <div className="max-w-xl mx-auto text-center">
            <div className="bg-white card-radius p-10 md:p-14 border border-surface-300/50 shadow-xl shadow-navy/5">
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-6">
                <CheckCircle size={32} className="text-white" />
              </div>
              <h2 className="font-heading font-bold text-2xl text-navy">
                Case Submitted!
              </h2>
              <p className="mt-1 font-mono text-xs text-navy/30">
                DOL-2026-
                {String(Math.floor(Math.random() * 9000) + 1000)}
              </p>
              <p className="mt-4 text-sm text-navy/50 max-w-sm mx-auto leading-relaxed">
                Your case has been received and queued for fabrication. We&apos;ll
                notify you at each milestone via email.
              </p>

              {/* Quick summary */}
              {form.product && (
                <div className="mt-6 inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-surface-50 border border-surface-300/30">
                  <img
                    src={form.product.image}
                    alt=""
                    className="w-10 h-10 rounded-lg object-contain bg-white p-1 border border-surface-300/20"
                  />
                  <div className="text-left">
                    <span className="text-xs font-semibold text-navy">
                      {form.product.name}
                    </span>
                    <span className="block text-[10px] text-navy/30">
                      {form.patientFirst} {form.patientLast}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-8 flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setSubmitted(false);
                    setStep(0);
                    setForm(INITIAL_FORM);
                  }}
                  className="px-6 py-3 rounded-full text-sm font-semibold border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all"
                >
                  Submit Another
                </button>
                <Link
                  to="/"
                  className="px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
                >
                  Back to Home
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  /* ── FORM ── */
  return (
    <div>
      <CaseHero />

      <section className="relative z-10 section-pad -mt-8 pb-20">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 overflow-hidden">
            <StepHeader current={step} total={STEPS.length} labels={STEPS} />

            {/* Step content */}
            <div ref={contentRef}>
              {/* ─── STEP 0: PRACTICE & PATIENT ─── */}
              {step === 0 && (
                <div className="space-y-8 p-6 md:p-8">
                  <div>
                    <h3 className="font-heading font-semibold text-base text-navy mb-4">
                      Practice Information
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Doctor Name" required>
                        <input
                          className={`${INPUT} ${errClass("doctorName")}`}
                          value={form.doctorName}
                          onChange={(e) => update("doctorName", e.target.value)}
                          placeholder="Dr. Jane Smith"
                        />
                      </Field>
                      <Field label="Practice Name" required>
                        <input
                          className={`${INPUT} ${errClass("practiceName")}`}
                          value={form.practiceName}
                          onChange={(e) =>
                            update("practiceName", e.target.value)
                          }
                          placeholder="Smile Dental Group"
                        />
                      </Field>
                      <Field label="Email" required>
                        <input
                          type="email"
                          className={`${INPUT} ${errClass("email")}`}
                          value={form.email}
                          onChange={(e) => update("email", e.target.value)}
                          placeholder="doctor@practice.com"
                        />
                      </Field>
                      <Field label="Phone">
                        <input
                          type="tel"
                          className={INPUT}
                          value={form.phone}
                          onChange={(e) => update("phone", e.target.value)}
                          placeholder="(555) 123-4567"
                        />
                      </Field>
                      <Field label="NPI Number">
                        <input
                          className={INPUT}
                          value={form.npi}
                          onChange={(e) => update("npi", e.target.value)}
                          placeholder="1234567890"
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-surface-300/30">
                    <h3 className="font-heading font-semibold text-base text-navy mb-4">
                      Patient Information
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="First Name" required>
                        <input
                          className={`${INPUT} ${errClass("patientFirst")}`}
                          value={form.patientFirst}
                          onChange={(e) =>
                            update("patientFirst", e.target.value)
                          }
                          placeholder="John"
                        />
                      </Field>
                      <Field label="Last Name" required>
                        <input
                          className={`${INPUT} ${errClass("patientLast")}`}
                          value={form.patientLast}
                          onChange={(e) =>
                            update("patientLast", e.target.value)
                          }
                          placeholder="Doe"
                        />
                      </Field>
                      <Field label="Date of Birth">
                        <input
                          type="date"
                          className={INPUT}
                          value={form.dob}
                          onChange={(e) => update("dob", e.target.value)}
                        />
                      </Field>
                      <Field label="Gender">
                        <select
                          className={INPUT}
                          value={form.gender}
                          onChange={(e) => update("gender", e.target.value)}
                        >
                          <option value="">Select...</option>
                          <option>Male</option>
                          <option>Female</option>
                          <option>Other</option>
                        </select>
                      </Field>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── STEP 1: PRODUCT SELECTION ─── */}
              {step === 1 && (
                <div className="p-6 md:p-8">
                  {form.product ? (
                    <div className="space-y-4">
                      <p className="text-sm text-navy/50">
                        Selected orthotic for this case:
                      </p>
                      <ProductThumb
                        product={form.product}
                        onEdit={() => setShowModal(true)}
                      />
                      <p className="text-[11px] text-navy/25">
                        Click to change selection
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Package
                        size={48}
                        className="mx-auto mb-4 text-navy/10"
                      />
                      <p className="text-sm text-navy/40 mb-6">
                        No product selected yet
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowModal(true)}
                        className={`btn-magnetic inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold transition-all ${
                          errors.includes("product")
                            ? "bg-red-50 text-red-500 border-2 border-red-300"
                            : "bg-brand-500 text-white hover:bg-brand-600"
                        }`}
                      >
                        <span className="relative z-10 flex items-center gap-2">
                          Choose Product
                          <ChevronRight size={16} />
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ─── STEP 2: CLINICAL DETAILS ─── */}
              {step === 2 && (
                <div className="space-y-8 p-6 md:p-8">
                  {/* Sleep-specific fields */}
                  {form.product?.category === "Sleep" && (
                    <div>
                      <h3 className="font-heading font-semibold text-base text-navy mb-4">
                        Sleep Study Details
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="AHI Score">
                          <input
                            type="number"
                            className={INPUT}
                            value={form.ahiScore}
                            onChange={(e) =>
                              update("ahiScore", e.target.value)
                            }
                            placeholder="e.g., 18"
                          />
                        </Field>
                        <Field label="Protrusion (mm)">
                          <input
                            type="number"
                            className={INPUT}
                            value={form.protrusion}
                            onChange={(e) =>
                              update("protrusion", e.target.value)
                            }
                            placeholder="e.g., 6"
                          />
                        </Field>
                        <Field label="Vertical Opening (mm)">
                          <input
                            type="number"
                            className={INPUT}
                            value={form.verticalOpening}
                            onChange={(e) =>
                              update("verticalOpening", e.target.value)
                            }
                            placeholder="e.g., 4"
                          />
                        </Field>
                        <Field label="Titration Type">
                          <select
                            className={INPUT}
                            value={form.titrationType}
                            onChange={(e) =>
                              update("titrationType", e.target.value)
                            }
                          >
                            <option value="">Select...</option>
                            <option>Fixed Position</option>
                            <option>Adjustable (Elastic Hooks)</option>
                          </select>
                        </Field>
                      </div>
                      <div className="mt-4">
                        <ToggleSwitch
                          label="Previous Sleep Appliance"
                          description="Has the patient worn a mandibular advancement device before?"
                          checked={form.previousAppliance}
                          onChange={(v) => update("previousAppliance", v)}
                        />
                      </div>
                    </div>
                  )}

                  {/* TMD-specific fields */}
                  {form.product?.category === "TMD" && (
                    <div>
                      <h3 className="font-heading font-semibold text-base text-navy mb-4">
                        TMD Assessment
                      </h3>
                      <div className="space-y-5">
                        <Field label="Primary Diagnosis">
                          <select
                            className={INPUT}
                            value={form.diagnosis}
                            onChange={(e) =>
                              update("diagnosis", e.target.value)
                            }
                          >
                            <option value="">Select...</option>
                            <option>
                              Temporomandibular Joint Dysfunction
                            </option>
                            <option>Myofascial Pain Disorder</option>
                            <option>Disc Displacement with Reduction</option>
                            <option>
                              Disc Displacement without Reduction
                            </option>
                            <option>Degenerative Joint Disease</option>
                            <option>Bruxism / Clenching</option>
                          </select>
                        </Field>
                        <PainScale
                          value={form.painLevel}
                          onChange={(v) => update("painLevel", v)}
                        />
                        <SymptomPills
                          selected={form.jointSymptoms}
                          onChange={(v) => update("jointSymptoms", v)}
                        />
                        <Field label="VDO Adjustment (mm)">
                          <input
                            type="number"
                            className={INPUT}
                            value={form.vdoAdjustment}
                            onChange={(e) =>
                              update("vdoAdjustment", e.target.value)
                            }
                            placeholder="e.g., 2"
                          />
                        </Field>
                      </div>
                    </div>
                  )}

                  {/* Common specifications */}
                  <div className="pt-6 border-t border-surface-300/30">
                    <h3 className="font-heading font-semibold text-base text-navy mb-4">
                      Specifications
                    </h3>
                    <div className="space-y-5">
                      <ArchSelector
                        value={form.arch}
                        onChange={(v) => update("arch", v)}
                      />
                      <Field label="Material" required>
                        <select
                          className={`${INPUT} ${errClass("material")}`}
                          value={form.material}
                          onChange={(e) => update("material", e.target.value)}
                        >
                          <option value="">Select material...</option>
                          {(MATERIALS[form.product?.id] || []).map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </Field>
                      <ToggleSwitch
                        label="Rush Order"
                        description="Expedited 3–5 day turnaround (+$75)"
                        checked={form.rushOrder}
                        onChange={(v) => update("rushOrder", v)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ─── STEP 3: FILE UPLOADS ─── */}
              {step === 3 && (
                <div className="space-y-6 p-6 md:p-8">
                  <FileUploadZone
                    label="Digital Scans *"
                    hint=".stl, .ply, .obj — Upper and lower arch scans"
                    accept=".stl,.ply,.obj"
                    files={form.scanFiles}
                    onAdd={(f) => addFiles("scanFiles", f)}
                    onRemove={(id) => removeFile("scanFiles", id)}
                  />
                  <FileUploadZone
                    label="Intraoral Photos"
                    hint=".jpg, .png — Occlusal, lateral, and frontal views"
                    accept="image/*"
                    files={form.photos}
                    onAdd={(f) => addFiles("photos", f)}
                    onRemove={(id) => removeFile("photos", id)}
                  />
                  <FileUploadZone
                    label="Prescription / Rx"
                    hint=".pdf — Signed prescription document"
                    accept=".pdf"
                    files={form.prescription}
                    onAdd={(f) => addFiles("prescription", f)}
                    onRemove={(id) => removeFile("prescription", id)}
                  />
                  {form.product?.category === "Sleep" && (
                    <FileUploadZone
                      label="Sleep Study Report"
                      hint=".pdf — Required for sleep appliance cases"
                      accept=".pdf"
                      files={form.sleepStudy}
                      onAdd={(f) => addFiles("sleepStudy", f)}
                      onRemove={(id) => removeFile("sleepStudy", id)}
                    />
                  )}
                  <Field label="Special Instructions">
                    <textarea
                      className={`${INPUT} resize-none`}
                      rows={4}
                      value={form.specialInstructions}
                      onChange={(e) =>
                        update("specialInstructions", e.target.value)
                      }
                      placeholder="Any additional notes, material preferences, bite adjustments, or special requirements..."
                    />
                  </Field>
                </div>
              )}

              {/* ─── STEP 4: REVIEW ─── */}
              {step === 4 && (
                <div className="space-y-4 p-6 md:p-8">
                  <ReviewSection
                    title="Practice & Patient"
                    onEdit={() => setStep(0)}
                  >
                    <div className="space-y-0.5">
                      <ReviewField label="Doctor" value={form.doctorName} />
                      <ReviewField label="Practice" value={form.practiceName} />
                      <ReviewField label="Email" value={form.email} />
                      {form.phone && (
                        <ReviewField label="Phone" value={form.phone} />
                      )}
                      {form.npi && (
                        <ReviewField label="NPI" value={form.npi} />
                      )}
                      <ReviewField
                        label="Patient"
                        value={`${form.patientFirst} ${form.patientLast}`}
                      />
                      {form.dob && (
                        <ReviewField label="DOB" value={form.dob} />
                      )}
                      {form.gender && (
                        <ReviewField label="Gender" value={form.gender} />
                      )}
                    </div>
                  </ReviewSection>

                  <ReviewSection
                    title="Product"
                    onEdit={() => setStep(1)}
                  >
                    {form.product && (
                      <ProductThumb
                        product={form.product}
                        onEdit={() => setStep(1)}
                      />
                    )}
                  </ReviewSection>

                  <ReviewSection
                    title="Clinical Details"
                    onEdit={() => setStep(2)}
                  >
                    <div className="space-y-0.5">
                      {form.product?.category === "Sleep" && (
                        <>
                          {form.ahiScore && (
                            <ReviewField label="AHI" value={form.ahiScore} />
                          )}
                          {form.protrusion && (
                            <ReviewField
                              label="Protrusion"
                              value={`${form.protrusion}mm`}
                            />
                          )}
                          {form.verticalOpening && (
                            <ReviewField
                              label="V. Opening"
                              value={`${form.verticalOpening}mm`}
                            />
                          )}
                          {form.titrationType && (
                            <ReviewField
                              label="Titration"
                              value={form.titrationType}
                            />
                          )}
                          <ReviewField
                            label="Prev. Device"
                            value={form.previousAppliance ? "Yes" : "No"}
                          />
                        </>
                      )}
                      {form.product?.category === "TMD" && (
                        <>
                          {form.diagnosis && (
                            <ReviewField
                              label="Diagnosis"
                              value={form.diagnosis}
                            />
                          )}
                          {form.painLevel > 0 && (
                            <ReviewField
                              label="Pain"
                              value={`${form.painLevel}/10`}
                            />
                          )}
                          {form.jointSymptoms.length > 0 && (
                            <ReviewField
                              label="Symptoms"
                              value={form.jointSymptoms.join(", ")}
                            />
                          )}
                          {form.vdoAdjustment && (
                            <ReviewField
                              label="VDO"
                              value={`${form.vdoAdjustment}mm`}
                            />
                          )}
                        </>
                      )}
                      <ReviewField
                        label="Arch"
                        value={
                          form.arch
                            ? form.arch.charAt(0).toUpperCase() +
                              form.arch.slice(1)
                            : ""
                        }
                      />
                      <ReviewField label="Material" value={form.material} />
                      {form.rushOrder && (
                        <ReviewField label="Rush" value="Yes (+$75)" />
                      )}
                    </div>
                  </ReviewSection>

                  <ReviewSection title="Files" onEdit={() => setStep(3)}>
                    {allFiles.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {allFiles.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-surface-300/30 text-xs"
                          >
                            {f.preview ? (
                              <img
                                src={f.preview}
                                alt=""
                                className="w-5 h-5 rounded object-cover"
                              />
                            ) : (
                              <FileText size={12} className="text-navy/30" />
                            )}
                            <span className="text-navy/60 truncate max-w-[100px]">
                              {f.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-navy/25 italic">
                        No files uploaded
                      </span>
                    )}
                    {form.specialInstructions && (
                      <div className="mt-3 pt-3 border-t border-surface-300/20">
                        <ReviewField
                          label="Notes"
                          value={form.specialInstructions}
                        />
                      </div>
                    )}
                  </ReviewSection>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="px-6 md:px-8 py-5 border-t border-surface-300/30 flex items-center justify-between">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={prev}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium text-navy/50 hover:text-navy hover:bg-surface-100 transition-all"
                >
                  <ChevronLeft size={16} /> Back
                </button>
              ) : (
                <div />
              )}

              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={next}
                  className="btn-magnetic flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors"
                >
                  <span className="relative z-10 flex items-center gap-1.5">
                    Continue <ChevronRight size={16} />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn-magnetic flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-60"
                >
                  <span className="relative z-10 flex items-center gap-1.5">
                    {submitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />{" "}
                        Submitting...
                      </>
                    ) : (
                      <>
                        Submit Case <Send size={16} />
                      </>
                    )}
                  </span>
                </button>
              )}
            </div>

            {/* Validation hint */}
            {errors.length > 0 && (
              <div className="px-6 md:px-8 pb-4 -mt-2">
                <p className="text-xs text-red-400 font-medium">
                  Please fill in the required fields highlighted above.
                </p>
              </div>
            )}
          </div>

          {/* Turnaround info */}
          <div className="mt-6 flex items-center justify-center gap-6 text-navy/25">
            <div className="flex items-center gap-2">
              <Clock size={14} />
              <span className="text-xs font-mono">~2 week turnaround</span>
            </div>
            <div className="flex items-center gap-2">
              <Package size={14} />
              <span className="text-xs font-mono">Ships nationwide</span>
            </div>
          </div>
        </div>
      </section>

      {/* Product modal */}
      {showModal && (
        <ProductModal
          selected={form.product}
          onSelect={handleProductSelect}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
