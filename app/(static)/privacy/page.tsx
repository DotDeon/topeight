export const metadata = { title: "Privacy - OpenSpace" };

export default function PrivacyPage() {
  return (
    <div className="prose">
      <h1>Privacy</h1>
      <p>
        OpenSpace stores your email address, date of birth, profile and the things you post. Your
        email address and date of birth are not shown to other members.
      </p>
      <p>
        Artist pages can load images, audio, video and scripts from other websites. Those
        websites can see your IP address when you view an artist page.
      </p>
      <p>
        Profile pages run on a separate address from the main site, and in a sandbox, so artist
        code cannot read your login. Treat any link or embedded content on a profile as you would
        any website you do not know.
      </p>
      <p>
        We use a login cookie to keep you signed in. We do not sell your data. To delete your
        account and its content, contact whoever runs this copy of OpenSpace.
      </p>
    </div>
  );
}
