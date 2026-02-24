import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import SecurityChecklist from '../components/SecurityChecklist.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('SecurityChecklist', SecurityChecklist)
  }
}
