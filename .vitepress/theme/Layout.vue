<script setup>
import DefaultTheme from 'vitepress/theme'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #doc-after>
      <div class="custom-footer">
        Made by <a href="https://eqtylab.io" target="_blank" rel="noopener">EQTY Lab</a>
      </div>
    </template>
  </Layout>
</template>
