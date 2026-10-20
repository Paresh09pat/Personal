/**
 * Pluggable mailer. SMTP when configured; otherwise links are printed to the server console so
 * the app works with zero accounts. Tests use the in-memory outbox.
 */
export async function createMailer(config, { memory = false } = {}) {
  if (memory) {
    const outbox = [];
    return { kind: 'memory', outbox, send: async (msg) => void outbox.push(msg) };
  }
  if (config.email.smtp) {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport(config.email.smtp);
    return {
      kind: 'smtp',
      send: (msg) => transport.sendMail({ from: config.email.from, ...msg }),
    };
  }
  return {
    kind: 'console',
    send: async (msg) => {
      console.log(
        `\n──── ✉  email to ${msg.to} ────\nSubject: ${msg.subject}\n${msg.text}\n────────────────────────────\n`,
      );
    },
  };
}

const wrap = (title, body, link, cta) => ({
  text: `${body}\n\n${cta}: ${link}\n\nIf you didn't ask for this, you can ignore this email.`,
  html: `<div style="font-family:Georgia,serif;max-width:480px;margin:auto;padding:32px;background:#fff7f8;border-radius:16px;color:#4a1d2c">
<h1 style="font-weight:400;color:#9f1d48">${title}</h1><p>${body}</p>
<p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#c2185b;color:#fff;border-radius:999px;text-decoration:none">${cta}</a></p>
<p style="font-size:12px;color:#8a5a6a">If you didn't ask for this, you can ignore this email.</p></div>`,
});

export const templates = {
  verifyEmail: (link) => ({
    subject: 'Confirm your email · Our Little World',
    ...wrap('Welcome 💌', 'Please confirm your email address to finish setting up your account.', link, 'Confirm email'),
  }),
  resetPassword: (link) => ({
    subject: 'Reset your password · Our Little World',
    ...wrap('Reset your password', 'Someone (hopefully you) asked to reset your password. This link works once and expires in 30 minutes.', link, 'Choose a new password'),
  }),
};
