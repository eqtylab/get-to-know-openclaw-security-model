import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'OpenClaw Security',
  description: 'Comprehensive security documentation for OpenClaw',
  themeConfig: {
    nav: [
      { text: 'Overview', link: '/' },
      { text: 'Goto Spec', link: '/goto-spec' },
      { text: 'Hardening', link: '/audit-hardening' }
    ],
    sidebar: [
      {
        text: 'Security Documentation',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Goto Spec', link: '/goto-spec' },
          { text: 'Access Control', link: '/access-control' },
          { text: 'Tool Security', link: '/tool-security' },
          { text: 'Network Security', link: '/network-security' },
          { text: 'Agent Configuration', link: '/agent-configuration' },
          { text: 'Plugins & Extensions', link: '/plugins-extensions' },
          { text: 'Pi Agent Security', link: '/pi-agent-security' },
          { text: 'Credentials & Secrets', link: '/credentials-secrets' },
          { text: 'Audit & Hardening', link: '/audit-hardening' }
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
