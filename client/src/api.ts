import axios from 'axios'

const API = axios.create({
  baseURL: 'http://localhost:5001/api',
})

export const registerUser = (userData: {
  username: string
  email: string
  password: string
}) => API.post('/register', userData)

export const loginUser = (userData: {
  email: string
  password: string
}) => API.post('/login', userData)
