export default function HeroBanner() {
  return (
    <div className="relative rounded-2xl overflow-hidden h-40 bg-gradient-to-r from-emerald-900/95 via-emerald-800/90 to-emerald-700/80">
      <img
        src="https://images.unsplash.com/photo-1622597467836-f3285f2131b8?w=1200&q=80"
        alt="Cold pressed juices"
        className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-40"
      />
      <div className="relative z-10 p-6 h-full flex flex-col justify-center">
        <p className="text-emerald-200/70 text-xs uppercase tracking-[0.2em] font-medium">
          NuVira Juice Company
        </p>
        <h2 className="text-white text-2xl lg:text-3xl font-display font-bold mt-1 leading-tight">
          Cold-Pressed.<br />100% Juice.
        </h2>
        <p className="text-emerald-200/60 text-sm mt-1">Aura · Re-Nu · Oasis</p>
      </div>
    </div>
  );
}