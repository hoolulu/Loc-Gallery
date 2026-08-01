import { createRouter, createWebHistory } from 'vue-router'
import BrowsePage from '@/pages/BrowsePage.vue'
import FavoritesPage from '@/pages/FavoritesPage.vue'
import HistoryPage from '@/pages/HistoryPage.vue'
import AlbumsPage from '@/pages/AlbumsPage.vue'
import AlbumDetailPage from '@/pages/AlbumDetailPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'browse', component: BrowsePage },
    { path: '/favorites', name: 'favorites', component: FavoritesPage },
    { path: '/history', name: 'history', component: HistoryPage },
    { path: '/albums', name: 'albums', component: AlbumsPage },
    { path: '/albums/:id', name: 'album-detail', component: AlbumDetailPage },
  ],
})

export default router
