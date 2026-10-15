/**
 * Who operates this deployment, as the legal pages state it. The name comes
 * from OPERATOR_NAME and from nowhere else: nothing is invented when it is not
 * set. Registration stays closed until it is (see getRegistrationState).
 */
export function OperatorStatement({ operatorName }: { operatorName: string | null }) {
  if (operatorName === null) {
    return (
      <p>
        The operator of this deployment has not been named yet. Registration is closed until an operator is named.
      </p>
    );
  }
  return <p>This deployment is operated by {operatorName}.</p>;
}
