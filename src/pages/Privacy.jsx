export default function Privacy() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4 space-y-6">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <div className="prose prose-sm max-w-none space-y-4 text-foreground/80">
        <p>
          <strong>Last Updated: April 2026</strong>
        </p>
        
        <section>
          <h2 className="text-xl font-semibold text-foreground">1. Information We Collect</h2>
          <p>We collect information you provide directly, such as your email, name, and business operations data.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">2. How We Use Information</h2>
          <p>Your information is used to provide and improve the nuVira Operations Hub service. We do not sell your data.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">3. Data Security</h2>
          <p>We implement industry-standard security measures to protect your information from unauthorized access.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">4. Third-Party Services</h2>
          <p>We may use third-party services for analytics and infrastructure. These services have their own privacy policies.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">5. Contact Us</h2>
          <p>For privacy inquiries, contact support@nuvira.com</p>
        </section>
      </div>
    </div>
  );
}