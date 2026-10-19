export const metadata = { title: "FAQ - OpenSpace" };

export default function FaqPage() {
  return (
    <div className="prose">
      <h1>FAQ</h1>
      <h2>How old do I have to be?</h2>
      <p>You must be at least 13 to sign up.</p>
      <h2>What is the difference between a fan and an artist?</h2>
      <p>
        Fans get a profile they can style with CSS. Artists can also add up to 10 MP3 tracks, list
        shows, and add their own HTML, CSS and JavaScript.
      </p>
      <h2>Why can I not post links yet?</h2>
      <p>
        New accounts cannot post links for their first 24 hours. This keeps spam down.
      </p>
      <h2>Where did Mail, Blog and Groups go?</h2>
      <p>
        They are not built yet. The links lead to a coming soon page.
      </p>
      <h2>How do I report something?</h2>
      <p>
        Use the Report link on any profile. See <a href="/safety">Safety Tips</a> for more.
      </p>
    </div>
  );
}
