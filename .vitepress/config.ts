import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'OpenClaw Security',
  description: 'A guide to understanding and hardening OpenClaw',
  themeConfig: {
    siteTitle: 'OpenClaw Security',
    nav: [
      { text: 'Overview', link: '/' },
      { text: 'Goto Spec', link: '/goto-spec' },
      { text: 'Checklist', link: '/security-checklist' },
      { text: 'EQTY Lab', link: 'https://eqtylab.io' }
    ],
    footer: {
      message: 'Made by <a href="https://eqtylab.io">EQTY Lab</a>',
      copyright: ''
    },
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Goto Spec', link: '/goto-spec' },
          { text: 'Security Checklist', link: '/security-checklist' },
        ]
      },
      {
        text: 'Security Domains',
        items: [
          { text: 'Access Control', link: '/access-control' },
          { text: 'Tool Security', link: '/tool-security' },
          { text: 'Network Security', link: '/network-security' },
          { text: 'Agent Configuration', link: '/agent-configuration' },
          { text: 'Plugins & Extensions', link: '/plugins-extensions' },
          { text: 'Pi Agent Security', link: '/pi-agent-security' },
          { text: 'ClawHub & Skills Safety', link: '/clawhub-skills-safety' },
          { text: 'Credentials & Secrets', link: '/credentials-secrets' },
          { text: 'Audit & Hardening', link: '/audit-hardening' },
          { text: 'Formal Verification', link: '/formal-verification' },
        ]
      }
    ],
    outline: {
      level: [2, 3]
    },
    search: {
      provider: 'local'
    }
  }
})
