export const metadata = { title: "About OpenSpace" };

export default function AboutPage() {
  return (
    <div className="prose">
      <h1>About OpenSpace</h1>
      <p>
        OpenSpace is a place for friends. You get a profile, a friend list, a comment wall and
        bulletins, laid out the way social sites looked in 2006. Artists can add music, shows
        and their own page code.
      </p>
      <p>
        OpenSpace is an open source rebuild released under the AGPL-3.0 license. It is not
        affiliated with MySpace or its owners, and it uses none of their artwork.
      </p>
      <h2 id="contact">Contact</h2>
      <p>
        Questions, bugs and takedown requests go to whoever runs this copy of OpenSpace. Use the
        contact address they publish, or report a profile from its own page.
      </p>
    </div>
  );
}
