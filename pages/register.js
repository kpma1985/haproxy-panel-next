import Head from 'next/head';
import { useRouter } from 'next/router';
import * as API from '../api.js'
import ErrorAlert from '../components/ErrorAlert.js';
import { useState, useContext } from 'react';
import { GlobalContext } from '../providers/GlobalProvider.js';

const Register = () => {

	const router = useRouter();
	const [state, dispatch] = useContext(GlobalContext);
	const [error, setError] = useState();

	async function register(e) {
		e.preventDefault();
		await API.register({
			username: e.target.username.value,
			password: e.target.password.value,
			rpasword: e.target.repeat_password.value,
		 }, dispatch, setError, router);
		router.push('/login');
	}
	
	return (
		<>
			<Head>
				<title>Register</title>
			</Head>

			{error && <ErrorAlert error={error} />}

			<h5 className="fw-bold">Register</h5>
			<form onSubmit={register} action="/forms/register" method="POST">
				<div className="mb-2">
					<label className="form-label">Username
						<input className="form-control" type="text" name="username" maxLength="50" required="required"/>
					</label>
				</div>
				<div className="mb-2">
					<label className="form-label">Password
						<input className="form-control" type="password" name="password" maxLength="100" required="required"/>
					</label>
				</div>
				<div className="mb-2">
					<label className="form-label">Repeat Password
						<input className="form-control" type="password" name="repeat_password" maxLength="100" required="required"/>
					</label>
				</div>
				<input className="btn btn-primary" type="submit" value="Submit"/>
			</form>

		</>
	);

};

export default Register;
